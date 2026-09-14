/**
 * Tender Registry routes — TO first tier (simple spreadsheet entry)
 */
const {
  REGISTRY_STATUSES,
  syncTenderStatus,
  isValidRegistryStatus,
  writeRegistryAudit,
  computeCustomerScore,
  KANBAN_REGISTRY_STATUSES,
  ensureTenderKanbanCard,
  buildRegistryExclusionClause,
  ensureReview
} = require('../services/tender-registry-helpers');
const { buildPeriodFilterSql } = require('../services/tender-registry-import-utils');
const {
  computeAnalysisDeadline,
  analysisBufferDays
} = require('../lib/business-days');

const ALLOWED_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

const LOSS_REASON_LABELS = {
  price: 'Цена выше конкурентов',
  deadline: 'Сроки / график не устроили',
  qual: 'Не прошли квалификацию / допуск',
  docs: 'Ошибка или неполнота документов',
  lobby: 'Предпочтение другому подрядчику',
  cancel: 'Закупка отменена / не состоялась',
  nobid: 'Не подали заявку'
};

const PATCHABLE_FIELDS = {
  customer_name: 'customer_name',
  customer_inn: 'customer_inn',
  tender_title: 'tender_title',
  tender_price: 'tender_price',
  docs_deadline: 'docs_deadline',
  purchase_url: 'purchase_url',
  comment_to: 'comment_to',
  reject_reason: 'reject_reason',
  participation_paid: 'participation_paid',
  participation_fee: 'participation_fee',
  participation: 'participation'
};

function parsePaidFlag(raw) {
  if (raw === true || raw === 'true' || raw === 1 || raw === '1') return true;
  return false;
}

function parseFee(raw) {
  if (raw === '' || raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function validateParticipation(paid, fee) {
  if (!paid) return { ok: true, fee: null };
  if (fee == null || !(fee > 0)) {
    return { ok: false, error: 'Укажите ориентировочную стоимость платного участия' };
  }
  return { ok: true, fee };
}

function buildSearchClause(q, params) {
  const raw = String(q || '').trim();
  if (!raw) return { clause: '', applied: null };
  const like = `%${raw.replace(/%/g, '\\%')}%`;
  params.push(like);
  const likeParam = params.length;
  if (/^\d+$/.test(raw)) {
    const num = parseInt(raw, 10);
    params.push(num);
    const numParam = params.length;
    return {
      clause: ` AND (t.registry_no = $${numParam} OR t.id = $${numParam} OR t.customer_name ILIKE $${likeParam} OR t.tender_title ILIKE $${likeParam} OR COALESCE(t.customer_inn,'') ILIKE $${likeParam})`,
      applied: raw
    };
  }
  return {
    clause: ` AND (t.customer_name ILIKE $${likeParam} OR t.tender_title ILIKE $${likeParam} OR COALESCE(t.customer_inn,'') ILIKE $${likeParam})`,
    applied: raw
  };
}

async function routes(fastify) {
  const db = fastify.db;
  const { broadcast } = require('./sse');

  function baseWhere(subtab) {
    const parts = ['t.deleted_at IS NULL'];
    if (subtab === 'archive') {
      parts.push("t.registry_status = 'отмена'");
    } else if (subtab === 'submitted') {
      parts.push("t.registry_status = 'подались'");
    } else if (subtab === 'in_work') {
      parts.push("t.registry_status IN ('подались', 'готовим')");
    } else {
      parts.push("COALESCE(t.registry_status, 'рассмотрение') != 'отмена'");
    }
    return parts.join(' AND ');
  }

  async function enrichRows(rows, viewerUser) {
    const cache = new Map();
    const viewerId = viewerUser?.id;
    const viewerRole = viewerUser?.role || '';
    const canSeeUnread = ['TO', 'HEAD_TO', 'ADMIN'].includes(viewerRole);
    const canSeeDirectorUnread = ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'ADMIN'].includes(viewerRole);
    for (const row of rows) {
      const key = row.customer_inn || row.customer_name;
      if (!key) { row.score = null; } else if (!cache.has(key)) {
        cache.set(key, await computeCustomerScore(db, row.customer_inn, row.customer_name));
        row.score = cache.get(key);
      } else {
        row.score = cache.get(key);
      }
      const rev = await db.query(`
        SELECT r.*, u.name AS calculator_name
        FROM tender_rp_reviews r
        LEFT JOIN users u ON u.id = r.calculator_user_id
        WHERE r.tender_id = $1
      `, [row.id]);
      row.rp_review = rev.rows[0] || null;
      row.review_unread = false;
      row.director_review_unread = false;
      row.thread_unread_count = 0;
      row.thread_last_question_preview = null;
      if (canSeeUnread && viewerId && row.rp_review?.to_notify_at) {
        try {
          const seen = await db.query(
            'SELECT seen_at FROM tender_registry_review_seen WHERE user_id = $1 AND tender_id = $2',
            [viewerId, row.id]
          );
          const seenAt = seen.rows[0]?.seen_at;
          row.review_unread = !seenAt || new Date(seenAt) < new Date(row.rp_review.to_notify_at);
        } catch (_) {
          row.review_unread = false;
        }
      }
      if (canSeeDirectorUnread && viewerId && row.rp_review?.director_notify_at) {
        try {
          const seen = await db.query(
            'SELECT seen_at FROM tender_registry_director_seen WHERE user_id = $1 AND tender_id = $2',
            [viewerId, row.id]
          );
          const seenAt = seen.rows[0]?.seen_at;
          row.director_review_unread = !seenAt || new Date(seenAt) < new Date(row.rp_review.director_notify_at);
        } catch (_) {
          row.director_review_unread = false;
        }
      }
      if (canSeeUnread && viewerId && row.rp_review) {
        try {
          const seen = await db.query(
            'SELECT last_seen_at FROM tender_rp_review_thread_seen WHERE user_id = $1 AND tender_id = $2',
            [viewerId, row.id]
          );
          const seenAt = seen.rows[0]?.last_seen_at || null;
          const unread = await db.query(`
            SELECT COUNT(*)::int AS c FROM tender_rp_review_messages m
            WHERE m.tender_id = $1 AND m.deleted_at IS NULL AND m.user_id != $2
              AND ($3::timestamptz IS NULL OR m.created_at > $3)
          `, [row.id, viewerId, seenAt]);
          row.thread_unread_count = unread.rows[0]?.c || 0;
          const lastQ = await db.query(`
            SELECT left(m.body, 200) AS preview, u.name AS author_name
            FROM tender_rp_review_messages m
            JOIN users u ON u.id = m.user_id
            WHERE m.tender_id = $1 AND m.deleted_at IS NULL
              AND u.role IN ('PM', 'HEAD_PM')
              AND length(trim(m.body)) > 0
            ORDER BY m.created_at DESC
            LIMIT 1
          `, [row.id]);
          if (lastQ.rows[0]?.preview) {
            row.thread_last_question_preview = lastQ.rows[0].preview;
            row.thread_last_question_author = lastQ.rows[0].author_name || null;
          }
        } catch (_) {
          row.thread_unread_count = 0;
          row.thread_last_question_preview = null;
        }
      }
    }
    return rows;
  }

  // GET /registry
  fastify.get('/registry', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request) => {
    const limit = Math.min(parseInt(request.query.limit || '500', 10), 2000);
    const offset = parseInt(request.query.offset || '0', 10);
    const subtab = request.query.subtab || 'registry';
    if (subtab === 'platform') {
      const { loadTenderGuruSettings } = require('../services/tenderguru-settings');
      const settings = await loadTenderGuruSettings(db);
      const r = await db.query(`
        SELECT * FROM tenderguru_candidates
        WHERE status = 'new'
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
      `, [limit, offset]);
      const cnt = await db.query(`SELECT COUNT(*)::int AS c FROM tenderguru_candidates WHERE status = 'new'`);
      return {
        items: r.rows,
        total: cnt.rows[0].c,
        subtab: 'platform',
        tenderguru: {
          enabled: settings.enabled,
          api_key_set: settings.api_key_set,
          enrich_max_age_months: settings.enrich_max_age_months,
          last_sync_at: settings.last_sync_at,
          last_sync_result: settings.last_sync_result
        }
      };
    }
    const where = baseWhere(subtab);
    const periodParam = request.query.period;
    const burnOnly = request.query.burn === '1' || request.query.burn_only === 'true';
    const countParams = [];
    const { clause: periodClause, applied: periodApplied } = buildPeriodFilterSql(
      periodParam === undefined ? 'current' : periodParam,
      countParams,
      {
        date_from: request.query.date_from,
        date_to: request.query.date_to,
        date_field: request.query.date_field,
      }
    );
    let burnClause = '';
    if (burnOnly) {
      burnClause = ` AND t.docs_deadline IS NOT NULL AND t.docs_deadline::date <= (CURRENT_DATE + INTERVAL '3 days') AND t.docs_deadline::date >= CURRENT_DATE AND t.registry_status NOT IN ('отмена','проиграли','выиграли')`;
    }

    // ТО видит весь отдел; «Скрыть чужие» — на клиенте.
    let scopeClause = '';

    const excludeClause = buildRegistryExclusionClause('t', 'cb');
    const { clause: searchClause, applied: searchApplied } = buildSearchClause(request.query.q, countParams);

    const listParams = [...countParams, limit, offset];
    const r = await db.query(`
      SELECT t.*,
             cb.name AS created_by_name,
             calc.name AS calculator_user_name,
             (SELECT COUNT(*)::int FROM documents d
               WHERE d.tender_id = t.id
                 AND COALESCE(d.type,'') NOT IN ('ocr-extract')) AS doc_count,
             EXISTS(
               SELECT 1 FROM works w
               WHERE w.tender_id = t.id AND w.deleted_at IS NULL
             ) OR t.work_assigned_pm_id IS NOT NULL AS has_work
      FROM tenders t
      LEFT JOIN users cb ON cb.id = t.created_by
      LEFT JOIN users calc ON calc.id = t.calculator_user_id
      WHERE ${where}${periodClause}${burnClause}${searchClause}${excludeClause}${scopeClause}
      ORDER BY t.created_at DESC
      LIMIT $${listParams.length - 1} OFFSET $${listParams.length}
    `, listParams);
    const items = await enrichRows(r.rows, request.user);
    const cnt = await db.query(
      `SELECT COUNT(*)::int AS c FROM tenders t
       LEFT JOIN users cb ON cb.id = t.created_by
       WHERE ${where}${periodClause}${burnClause}${searchClause}${excludeClause}${scopeClause}`,
      countParams
    );
    return {
      items,
      total: cnt.rows[0].c,
      subtab,
      period: periodApplied,
      burn_only: burnOnly,
      search: searchApplied,
      statuses: REGISTRY_STATUSES
    };
  });

  // POST /registry/:id/review-seen — ТО отметил анализ/отчёт просмотренным
  fastify.post('/registry/:id/review-seen', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request) => {
    const tenderId = parseInt(request.params.id, 10);
    const userId = request.user.id;
    await db.query(`
      INSERT INTO tender_registry_review_seen (user_id, tender_id, seen_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (user_id, tender_id) DO UPDATE SET seen_at = NOW()
    `, [userId, tenderId]);
    return { ok: true };
  });

  // POST /registry — quick create
  fastify.post('/registry', {
    preHandler: [fastify.requireRoles(['ADMIN', 'TO', 'HEAD_TO', 'PM', 'HEAD_PM', ...['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV']])]
  }, async (request, reply) => {
    const b = request.body || {};
    const customer_name = String(b.customer_name || b.customer || '').trim();
    const tender_title = String(b.tender_title || b.title || '').trim();
    if (!customer_name && !tender_title) {
      return reply.code(400).send({ error: 'Укажите заказчика или название тендера' });
    }
    const docsDeadline = b.docs_deadline || b.deadline || null;
    if (!docsDeadline) {
      return reply.code(400).send({ error: 'Укажите дату подачи (срок)' });
    }
    const participation_paid = parsePaidFlag(b.participation_paid);
    const feeCheck = validateParticipation(participation_paid, parseFee(b.participation_fee));
    if (!feeCheck.ok) return reply.code(400).send({ error: feeCheck.error });
    const participation_fee = feeCheck.fee;
    const analysis_deadline = computeAnalysisDeadline({
      docs_deadline: docsDeadline,
      participation_paid,
      created_at: new Date()
    });

    const role = request.user.role;
    let source_kind = 'to_manual';
    if (role === 'PM' || role === 'HEAD_PM') source_kind = 'pm_manual';
    if (b.source_kind === 'tenderguru') source_kind = 'tenderguru';

    const registry_status = b.registry_status && isValidRegistryStatus(b.registry_status)
      ? b.registry_status : 'рассмотрение';
    const now = new Date();
    const period = b.period || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const r = await db.query(`
      INSERT INTO tenders (
        customer_name, customer_inn, tender_title, tender_price, docs_deadline, purchase_url,
        registry_status, tender_status, source_kind, created_by, created_by_user_id, period,
        participation_paid, participation_fee, analysis_deadline, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12,$13,$14,NOW())
      RETURNING *
    `, [
      customer_name || null,
      b.customer_inn || null,
      tender_title || null,
      b.tender_price ?? b.nmc ?? null,
      docsDeadline,
      b.purchase_url || null,
      registry_status,
      syncTenderStatus(registry_status),
      source_kind,
      request.user.id,
      period,
      participation_paid,
      participation_fee,
      analysis_deadline
    ]);

    const tender = r.rows[0];
    tender.analysis_buffer_days = analysisBufferDays(participation_paid);
    await writeRegistryAudit(db, {
      actorUserId: request.user.id, tenderId: tender.id,
      action: 'registry_create', before: null, after: tender
    });
    broadcast('tender:registry:changed', { id: tender.id });
    return { tender };
  });

  // GET /registry/find-duplicates — title and/or purchase_url match before create
  fastify.get('/registry/find-duplicates', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request) => {
    const title = String(request.query.title || request.query.tender_title || '').trim();
    const url = String(request.query.purchase_url || request.query.url || '').trim();
    if (!title && !url) return { items: [] };

    const params = [];
    const clauses = ['t.deleted_at IS NULL'];
    if (title) {
      params.push(title.toLowerCase());
      clauses.push(`LOWER(TRIM(COALESCE(t.tender_title, ''))) = $${params.length}`);
    }
    if (url) {
      params.push(url.toLowerCase());
      clauses.push(`LOWER(TRIM(COALESCE(t.purchase_url, ''))) = $${params.length}`);
    }
    // OR between title and url when both provided
    let where;
    if (title && url) {
      where = `t.deleted_at IS NULL AND (
        LOWER(TRIM(COALESCE(t.tender_title, ''))) = $1
        OR LOWER(TRIM(COALESCE(t.purchase_url, ''))) = $2
      )`;
    } else {
      where = clauses.join(' AND ');
    }

    const r = await db.query(`
      SELECT t.id, t.tender_title, t.customer_name, t.purchase_url,
             t.registry_status, t.tender_status, t.created_at,
             cb.name AS created_by_name
      FROM tenders t
      LEFT JOIN users cb ON cb.id = t.created_by
      WHERE ${where}
      ORDER BY t.id DESC
      LIMIT 10
    `, params);
    return { items: r.rows };
  });

  // PATCH /registry/:id — inline single field
  fastify.patch('/registry/:id', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const { id } = request.params;
    const { field, value } = request.body || {};
    const col = PATCHABLE_FIELDS[field];
    if (!col) return reply.code(400).send({ error: 'Недопустимое поле', allowed: Object.keys(PATCHABLE_FIELDS) });

    if (col === 'docs_deadline' && (value === '' || value == null)) {
      return reply.code(400).send({ error: 'Дата подачи обязательна' });
    }

    const cur = await db.query('SELECT * FROM tenders WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!cur.rows[0]) return reply.code(404).send({ error: 'Тендер не найден' });
    const beforeRow = cur.rows[0];

    // Compound participation update (paid + fee atomically)
    if (col === 'participation') {
      const payload = (value && typeof value === 'object') ? value : {};
      const participation_paid = parsePaidFlag(
        payload.participation_paid != null ? payload.participation_paid : payload.paid
      );
      const feeCheck = validateParticipation(
        participation_paid,
        parseFee(payload.participation_fee != null ? payload.participation_fee : payload.fee)
      );
      if (!feeCheck.ok) return reply.code(400).send({ error: feeCheck.error });
      const participation_fee = feeCheck.fee;
      const analysis_deadline = computeAnalysisDeadline({
        docs_deadline: beforeRow.docs_deadline,
        participation_paid,
        created_at: beforeRow.created_at
      });
      const r = await db.query(`
        UPDATE tenders SET
          participation_paid = $1,
          participation_fee = $2,
          analysis_deadline = $3,
          updated_at = NOW()
        WHERE id = $4 RETURNING *
      `, [participation_paid, participation_fee, analysis_deadline, id]);
      await writeRegistryAudit(db, {
        actorUserId: request.user.id, tenderId: id,
        action: 'registry_patch', field: 'participation',
        before: {
          participation_paid: beforeRow.participation_paid,
          participation_fee: beforeRow.participation_fee
        },
        after: { participation_paid, participation_fee }
      });
      broadcast('tender:registry:changed', { id: parseInt(id, 10) });
      return { tender: r.rows[0] };
    }

    const before = beforeRow[col];

    let nextValue = value === '' ? null : value;
    if (col === 'participation_paid') nextValue = parsePaidFlag(value);
    if (col === 'participation_fee') nextValue = parseFee(value);

    let participation_paid = parsePaidFlag(beforeRow.participation_paid);
    let participation_fee = beforeRow.participation_fee != null ? Number(beforeRow.participation_fee) : null;
    let docs_deadline = beforeRow.docs_deadline;

    if (col === 'participation_paid') participation_paid = nextValue;
    if (col === 'participation_fee') participation_fee = nextValue;
    if (col === 'docs_deadline') docs_deadline = nextValue;

    if (col === 'participation_paid' || col === 'participation_fee') {
      if (col === 'participation_paid' && !participation_paid) {
        participation_fee = null;
      } else {
        const feeCheck = validateParticipation(participation_paid, participation_fee);
        if (!feeCheck.ok) return reply.code(400).send({ error: feeCheck.error });
        participation_fee = feeCheck.fee;
      }
    }

    const needsDeadlineRecalc = ['docs_deadline', 'participation_paid', 'participation_fee'].includes(col);
    if (needsDeadlineRecalc) {
      const analysis_deadline = computeAnalysisDeadline({
        docs_deadline,
        participation_paid,
        created_at: beforeRow.created_at
      });
      let r;
      if (col === 'participation_paid') {
        r = await db.query(`
          UPDATE tenders SET
            participation_paid = $1,
            participation_fee = $2,
            analysis_deadline = $3,
            updated_at = NOW()
          WHERE id = $4 RETURNING *
        `, [participation_paid, participation_fee, analysis_deadline, id]);
      } else if (col === 'participation_fee') {
        r = await db.query(`
          UPDATE tenders SET
            participation_fee = $1,
            analysis_deadline = $2,
            updated_at = NOW()
          WHERE id = $3 RETURNING *
        `, [participation_fee, analysis_deadline, id]);
      } else {
        r = await db.query(`
          UPDATE tenders SET
            docs_deadline = $1,
            analysis_deadline = $2,
            updated_at = NOW()
          WHERE id = $3 RETURNING *
        `, [nextValue, analysis_deadline, id]);
      }
      await writeRegistryAudit(db, {
        actorUserId: request.user.id, tenderId: id,
        action: 'registry_patch', field, before,
        after: col === 'participation_paid' ? participation_paid
          : col === 'participation_fee' ? participation_fee
            : r.rows[0][col]
      });
      broadcast('tender:registry:changed', { id: parseInt(id, 10) });
      return { tender: r.rows[0] };
    }

    const r = await db.query(`
      UPDATE tenders SET ${col} = $1, updated_at = NOW() WHERE id = $2 RETURNING *
    `, [nextValue, id]);

    await writeRegistryAudit(db, {
      actorUserId: request.user.id, tenderId: id,
      action: 'registry_patch', field, before, after: r.rows[0][col]
    });
    broadcast('tender:registry:changed', { id: parseInt(id, 10) });
    return { tender: r.rows[0] };
  });

  // PATCH /registry/:id/status
  fastify.patch('/registry/:id/status', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body || {};
    const { registry_status } = body;
    if (!isValidRegistryStatus(registry_status)) {
      return reply.code(400).send({ error: 'Недопустимый статус', allowed: REGISTRY_STATUSES });
    }
    const cur = await db.query('SELECT * FROM tenders WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!cur.rows[0]) return reply.code(404).send({ error: 'Тендер не найден' });

    if (registry_status === 'проиграли') {
      const lossReasons = body.loss_reasons;
      if (!Array.isArray(lossReasons) || !lossReasons.length) {
        return reply.code(400).send({ error: 'Укажите хотя бы одну причину проигрыша', code: 'loss_reasons_required' });
      }
      const reasonLabels = lossReasons.map((k) => LOSS_REASON_LABELS[k] || String(k));
      const rejectReason = reasonLabels.join('; ');
      const tender_status = syncTenderStatus(registry_status);
      const winnerPrice = body.winner_price != null && body.winner_price !== ''
        ? Number(body.winner_price) : null;
      const r = await db.query(`
        UPDATE tenders SET
          registry_status = $1,
          tender_status = $2,
          reject_reason = $3,
          lose_cover_letter = COALESCE($4, lose_cover_letter),
          winner_name = COALESCE($5, winner_name),
          loss_winner_price = $6,
          loss_reasons = $7::jsonb,
          lost_at = NOW(),
          lost_by_user_id = $8,
          updated_at = NOW()
        WHERE id = $9 RETURNING *
      `, [
        registry_status,
        tender_status,
        rejectReason,
        body.comment || null,
        body.winner_name || null,
        Number.isFinite(winnerPrice) ? winnerPrice : null,
        JSON.stringify(lossReasons),
        request.user.id,
        id
      ]);

      await writeRegistryAudit(db, {
        actorUserId: request.user.id, tenderId: id,
        action: 'registry_lost',
        before: cur.rows[0].registry_status,
        after: { registry_status, loss_reasons: lossReasons, winner_price: winnerPrice }
      });

      broadcast('tender:registry:changed', { id: parseInt(id, 10) });
      const score = await computeCustomerScore(db, r.rows[0].customer_inn, r.rows[0].customer_name);
      return { tender: r.rows[0], score };
    }

    const tender_status = syncTenderStatus(registry_status);
    const isSubmitted = registry_status === 'подались';
    if (isSubmitted) {
      const sub = body.submission_price != null && body.submission_price !== ''
        ? Number(body.submission_price) : null;
      const subVat = body.submission_price_with_vat != null && body.submission_price_with_vat !== ''
        ? Number(body.submission_price_with_vat) : null;
      if (!(Number.isFinite(sub) && sub > 0) && !(Number.isFinite(subVat) && subVat > 0)) {
        return reply.code(400).send({
          error: 'Укажите сумму подачи',
          code: 'submission_price_required'
        });
      }
      const vatPct = body.vat_pct != null && body.vat_pct !== ''
        ? Number(body.vat_pct)
        : (cur.rows[0].vat_pct != null ? Number(cur.rows[0].vat_pct) : 22);
      const finalNoVat = Number.isFinite(sub) && sub > 0
        ? sub
        : Math.round((subVat / (1 + (Number.isFinite(vatPct) ? vatPct : 22) / 100)) * 100) / 100;
      const finalWithVat = Number.isFinite(subVat) && subVat > 0
        ? subVat
        : Math.round(finalNoVat * (1 + (Number.isFinite(vatPct) ? vatPct : 22) / 100) * 100) / 100;

      const r = await db.query(`
        UPDATE tenders SET
          registry_status = $1,
          tender_status = $2,
          submission_price = $3,
          submission_price_with_vat = $4,
          vat_pct = $5,
          submitted_at = COALESCE(submitted_at, NOW()),
          updated_at = NOW()
        WHERE id = $6 RETURNING *
      `, [registry_status, tender_status, finalNoVat, finalWithVat, Number.isFinite(vatPct) ? vatPct : 22, id]);

      await writeRegistryAudit(db, {
        actorUserId: request.user.id, tenderId: id,
        action: 'registry_status', field: 'registry_status',
        before: cur.rows[0].registry_status,
        after: { registry_status, submission_price: finalNoVat, submission_price_with_vat: finalWithVat }
      });

      if (KANBAN_REGISTRY_STATUSES.has(registry_status)) {
        const ownerId = cur.rows[0].created_by_user_id || cur.rows[0].created_by || request.user.id;
        await ensureTenderKanbanCard(db, parseInt(id, 10), ownerId);
      }

      broadcast('tender:registry:changed', { id: parseInt(id, 10) });
      return { tender: r.rows[0] };
    }

    const extra = registry_status === 'отмена'
      ? ', archived_at = NOW(), archived_by = $4, archive_reason = $5'
      : '';
    const params = [registry_status, tender_status, id];
    if (registry_status === 'отмена') {
      // Soft default only when reason omitted; empty string is intentional.
      const reason = Object.prototype.hasOwnProperty.call(body, 'archive_reason')
        ? (body.archive_reason == null ? '' : String(body.archive_reason))
        : 'Архив реестра';
      params.push(request.user.id, reason);
    }

    const r = await db.query(`
      UPDATE tenders SET registry_status = $1, tender_status = $2, updated_at = NOW()
        ${extra}
      WHERE id = $3 RETURNING *
    `, params);

    await writeRegistryAudit(db, {
      actorUserId: request.user.id, tenderId: id,
      action: 'registry_status', field: 'registry_status',
      before: cur.rows[0].registry_status, after: registry_status
    });

    if (KANBAN_REGISTRY_STATUSES.has(registry_status)) {
      const ownerId = cur.rows[0].created_by_user_id || cur.rows[0].created_by || request.user.id;
      await ensureTenderKanbanCard(db, parseInt(id, 10), ownerId);
    }

    broadcast('tender:registry:changed', { id: parseInt(id, 10) });
    return { tender: r.rows[0] };
  });

  // POST /registry/:id/assign-calculator — ТО назначает РП или «считаю сам»
  fastify.post('/registry/:id/assign-calculator', {
    preHandler: [fastify.requireRoles(['ADMIN', 'TO', 'HEAD_TO', 'PM', 'HEAD_PM', ...['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV']])]
  }, async (request, reply) => {
    const { id } = request.params;
    const { kind, user_id } = request.body || {};
    // Ручное назначение РП убрано — просчёт всегда делает дежурный РП.
    // Остаётся только «ТО считает сам» (kind=to).
    if (kind !== 'to') {
      return reply.code(400).send({ error: 'Назначение РП отключено. Просчёт делает дежурный РП, либо «Считаю сам» (ТО).' });
    }
    const cur = await db.query('SELECT * FROM tenders WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!cur.rows[0]) return reply.code(404).send({ error: 'Тендер не найден' });
    const tender = cur.rows[0];
    const st = tender.registry_status || 'рассмотрение';
    if (st !== 'рассмотрение') {
      return reply.code(400).send({ error: 'Назначить считающего можно только в статусе «рассмотрение»' });
    }

    const revRes = await db.query(
      'SELECT analysis_finalized_at, is_final FROM tender_rp_reviews WHERE tender_id = $1',
      [id]
    );
    const revRow = revRes.rows[0];
    if (!revRow?.analysis_finalized_at) {
      return reply.code(400).send({
        error: 'Назначить считающего можно только после закрытия анализа дежурного РП'
      });
    }
    if (revRow.is_final) {
      return reply.code(400).send({ error: 'Просчёт уже закрыт — назначение недоступно' });
    }

    let calcUserId = user_id ? Number(user_id) : null;
    if (kind === 'to') {
      calcUserId = calcUserId || request.user.id;
    }
    if (kind === 'pm' && !calcUserId) {
      return reply.code(400).send({ error: 'Укажите user_id РП' });
    }

    const u = await db.query('SELECT id, name, role FROM users WHERE id = $1 AND is_active = true', [calcUserId]);
    if (!u.rows[0]) return reply.code(400).send({ error: 'Пользователь не найден' });
    const calcUser = u.rows[0];
    if (kind === 'pm' && !['PM', 'HEAD_PM'].includes(calcUser.role)) {
      return reply.code(400).send({ error: 'Для pm нужен пользователь с ролью РП' });
    }
    if (kind === 'to' && !['TO', 'HEAD_TO'].includes(calcUser.role)) {
      return reply.code(400).send({ error: 'Для to нужен пользователь ТО' });
    }

    const oldCalcId = tender.calculator_user_id != null ? Number(tender.calculator_user_id) : null;

    if (kind === 'pm') {
      await db.query(`
        UPDATE tenders SET
          calculator_kind = $1,
          calculator_user_id = $2,
          responsible_pm_id = $2,
          updated_at = NOW()
        WHERE id = $3
      `, [kind, calcUserId, id]);
    } else {
      await db.query(`
        UPDATE tenders SET
          calculator_kind = $1,
          calculator_user_id = $2,
          updated_at = NOW()
        WHERE id = $3
      `, [kind, calcUserId, id]);
    }

    const rev = await ensureReview(db, id, calcUserId);
    await db.query(`
      UPDATE tender_rp_reviews SET calculator_user_id = $1, updated_at = NOW() WHERE id = $2
    `, [calcUserId, rev.id]);

    await writeRegistryAudit(db, {
      actorUserId: request.user.id, tenderId: id,
      action: 'assign_calculator', after: { kind, calculator_user_id: calcUserId, calculator_name: calcUser.name }
    });

    if (kind === 'pm' || kind === 'to') {
      const { notifyPmCalcEvent, notifyPmReleasedFromCalc } = require('../services/tender-assign-notify');
      const tInfo = {
        id: Number(id),
        customer_name: tender.customer_name,
        tender_title: tender.tender_title,
        registry_no: tender.registry_no
      };
      const actorName = request.user.name || 'ТО';
      const isReassign = oldCalcId && oldCalcId !== calcUserId;
      await notifyPmCalcEvent(db, {
        userId: calcUserId,
        kind: isReassign ? 'reassign' : 'assign',
        tender: tInfo,
        actorName,
        link: kind === 'to' ? '#/to-calcs' : '#/pm-duty',
        actorUserId: request.user.id,
        log: request.log
      });
      if (isReassign) {
        await notifyPmReleasedFromCalc(db, {
          userId: oldCalcId,
          tender: tInfo,
          actorName,
          log: request.log
        });
      }
    }

    broadcast('tender:registry:changed', { id: parseInt(id, 10) });
    const updated = await db.query('SELECT * FROM tenders WHERE id = $1', [id]);
    return { tender: updated.rows[0] };
  });

  // POST /registry/:id/archive
  fastify.post('/registry/:id/archive', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const { id } = request.params;
    const cur = await db.query('SELECT * FROM tenders WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!cur.rows[0]) return reply.code(404).send({ error: 'Тендер не найден' });

    const r = await db.query(`
      UPDATE tenders SET registry_status = 'отмена', tender_status = 'Не подходит',
        archived_at = NOW(), archived_by = $1, archive_reason = $2, updated_at = NOW()
      WHERE id = $3 RETURNING *
    `, [request.user.id, request.body?.archive_reason || 'Архив реестра', id]);

    await writeRegistryAudit(db, {
      actorUserId: request.user.id, tenderId: id,
      action: 'registry_archive', before: cur.rows[0].registry_status, after: 'отмена'
    });
    broadcast('tender:registry:changed', { id: parseInt(id, 10) });
    return { tender: r.rows[0] };
  });

  // GET /registry/:id/history
  fastify.get('/registry/:id/history', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const { id } = request.params;
    const r = await db.query(`
      SELECT a.*, u.name AS actor_name
      FROM audit_log a
      LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE a.entity_type = 'tender' AND a.entity_id = $1
      ORDER BY a.created_at DESC
      LIMIT 200
    `, [id]);
    return { history: r.rows };
  });

  // POST /registry/platform/:candidateId/accept
  fastify.post('/registry/platform/:candidateId/accept', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const c = await db.query('SELECT * FROM tenderguru_candidates WHERE id = $1', [request.params.candidateId]);
    if (!c.rows[0]) return reply.code(404).send({ error: 'Кандидат не найден' });
    const cand = c.rows[0];
    const ins = await db.query(`
      INSERT INTO tenders (customer_name, customer_inn, tender_title, tender_price, docs_deadline, purchase_url,
        registry_status, tender_status, source_kind, created_by, period, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,'рассмотрение','Новый','tenderguru',$7,
        to_char(NOW(),'YYYY-MM'), NOW())
      RETURNING *
    `, [cand.customer_name, cand.customer_inn, cand.title, cand.nmc, cand.deadline, cand.purchase_url, request.user.id]);
    await db.query(`
      UPDATE tenderguru_candidates SET status = 'accepted', matched_tender_id = $1, updated_at = NOW()
      WHERE id = $2
    `, [ins.rows[0].id, cand.id]);
    return { tender: ins.rows[0] };
  });

  fastify.post('/registry/platform/:candidateId/dismiss', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const status = request.body?.duplicate ? 'duplicate' : 'dismissed';
    const r = await db.query(`
      UPDATE tenderguru_candidates SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *
    `, [status, request.params.candidateId]);
    if (!r.rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    return { candidate: r.rows[0] };
  });

  // POST /registry/:id/create-work — win + assign from registry
  fastify.post('/registry/:id/create-work', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const { id } = request.params;
    const { pm_id } = request.body || {};
    if (!pm_id) return reply.code(400).send({ error: 'pm_id обязателен' });

    const cur = await db.query('SELECT * FROM tenders WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!cur.rows[0]) return reply.code(404).send({ error: 'Тендер не найден' });

    const existingWork = await db.query(`
      SELECT * FROM works
      WHERE tender_id = $1 AND deleted_at IS NULL AND COALESCE(work_kind, 'main') = 'main'
      ORDER BY id ASC
      LIMIT 1
    `, [id]);
    if (existingWork.rows[0]) {
      return reply.code(409).send({
        error: 'Работа по этому тендеру уже существует',
        work: existingWork.rows[0]
      });
    }

    await db.query(`
      UPDATE tenders SET registry_status = 'выиграли', tender_status = 'КП отправлено', updated_at = NOW()
      WHERE id = $1
    `, [id]);

    const winRes = await db.query(`
      UPDATE tenders SET tender_status = 'Выиграли', won_at = NOW(), won_by_user_id = $1, updated_at = NOW()
      WHERE id = $2 RETURNING *
    `, [request.user.id, id]);

    const tender = winRes.rows[0];
    const { createNotification } = require('../services/notify');
    const estimate = await db.query(`
      SELECT price_tkp FROM estimates WHERE tender_id = $1 AND status = 'approved' ORDER BY id DESC LIMIT 1
    `, [id]).catch(() => ({ rows: [] }));

    const contract_value = tender.submission_price || tender.tender_price || estimate.rows[0]?.price_tkp || null;
    const work = await db.query(`
      INSERT INTO works (
        tender_id, pm_id, customer_name, work_title, work_status, work_kind,
        start_in_work_date, end_plan, contract_value, site_id, created_by, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,'Подготовка','main',NULL,NULL,$5,$6,$7,NOW(),NOW()) RETURNING *
    `, [id, pm_id, tender.customer_name, tender.tender_title || tender.customer_name, contract_value, tender.site_id, request.user.id]);

    await db.query(`
      UPDATE tenders SET work_assigned_pm_id = $1, work_assigned_at = NOW(), work_assigned_by_user_id = $2
      WHERE id = $3
    `, [pm_id, request.user.id, id]);

    broadcast('tender:registry:changed', { id: parseInt(id, 10) });
    return { tender, work: work.rows[0] };
  });

  // POST /registry/cleanup
  fastify.post('/registry/cleanup', {
    preHandler: [fastify.requireRoles(['ADMIN', 'HEAD_TO', 'DIRECTOR_GEN'])]
  }, async (request) => {
    const dryRun = request.body?.dry_run !== false;
    const noWork = await db.query(`
      SELECT t.id FROM tenders t
      LEFT JOIN works w ON w.tender_id = t.id AND w.deleted_at IS NULL
      WHERE t.deleted_at IS NULL AND w.id IS NULL
    `);
    const withWork = await db.query(`
      SELECT t.id, w.id AS work_id FROM tenders t
      JOIN works w ON w.tender_id = t.id AND w.deleted_at IS NULL
      WHERE t.deleted_at IS NULL
    `);
    if (!dryRun) {
      for (const row of noWork.rows) {
        await db.query('UPDATE tenders SET deleted_at = NOW() WHERE id = $1', [row.id]);
      }
    }
    return {
      dry_run: dryRun,
      soft_delete_count: noWork.rows.length,
      merge_candidates: withWork.rows.length
    };
  });

  // POST /registry/archive-stale — убрать из активного реестра старые/тестовые строки
  fastify.post('/registry/archive-stale', {
    preHandler: [fastify.requireRoles(['ADMIN', 'HEAD_TO', 'DIRECTOR_GEN'])]
  }, async (request) => {
    const dryRun = request.body?.dry_run !== false;
    const minPeriod = String(request.body?.min_period || '2026-01');
    const staleDays = Math.max(30, parseInt(request.body?.stale_days || '62', 10));

    const r = await db.query(`
      SELECT t.id, t.customer_name, t.tender_title, t.period, t.docs_deadline, t.registry_status
      FROM tenders t
      LEFT JOIN works w ON w.tender_id = t.id AND w.deleted_at IS NULL
      WHERE t.deleted_at IS NULL
        AND w.id IS NULL
        AND COALESCE(t.registry_status, 'рассмотрение') NOT IN ('отмена', 'выиграли', 'проиграли', 'подались')
        AND (
          t.period < $1
          OR (t.docs_deadline IS NOT NULL AND t.docs_deadline::date < (CURRENT_DATE - ($2 || ' days')::interval))
          OR LOWER(COALESCE(t.customer_name, '')) LIKE '%test%'
          OR LOWER(COALESCE(t.tender_title, '')) LIKE '%test%'
          OR LOWER(COALESCE(t.customer_name, '')) LIKE '%тест%'
          OR LOWER(COALESCE(t.tender_title, '')) LIKE '%тест%'
          OR LOWER(COALESCE(t.customer_name, '')) LIKE '%post deadline%'
        )
      ORDER BY t.id
      LIMIT 5000
    `, [minPeriod, String(staleDays)]);

    if (!dryRun && r.rows.length) {
      const ids = r.rows.map((row) => row.id);
      await db.query(`
        UPDATE tenders
        SET registry_status = 'отмена',
            tender_status = COALESCE(NULLIF(tender_status, ''), 'Не подходит'),
            updated_at = NOW()
        WHERE id = ANY($1::int[])
      `, [ids]);
      broadcast('tender:registry:changed', { action: 'archive-stale', count: ids.length });
    }

    return {
      dry_run: dryRun,
      min_period: minPeriod,
      stale_days: staleDays,
      matched: r.rows.length,
      sample: r.rows.slice(0, 15).map((row) => ({
        id: row.id,
        customer_name: row.customer_name,
        tender_title: row.tender_title,
        period: row.period,
        docs_deadline: row.docs_deadline,
        registry_status: row.registry_status
      }))
    };
  });

  // POST /registry/import — final stage (stub delegates to script)
  fastify.post('/registry/import', {
    preHandler: [fastify.requireRoles(['ADMIN', 'HEAD_TO'])]
  }, async (request, reply) => {
    const { spawnImport } = require('../services/tender-registry-import');
    try {
      const result = await spawnImport(db, request.body || {});
      return result;
    } catch (e) {
      return reply.code(500).send({ error: e.message });
    }
  });

  // ─── TenderGuru settings & sync ───────────────────────────────────────────
  const { loadTenderGuruSettings, saveTenderGuruSettings } = require('../services/tenderguru-settings');
  const { runTenderGuruSync } = require('../services/tenderguru-cron');

  fastify.get('/registry/tenderguru/settings', {
    preHandler: [fastify.requireRoles(['ADMIN', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'])]
  }, async () => {
    const settings = await loadTenderGuruSettings(db);
    return { settings };
  });

  fastify.put('/registry/tenderguru/settings', {
    preHandler: [fastify.requireRoles(['ADMIN', 'TO', 'HEAD_TO'])]
  }, async (request, reply) => {
    const body = request.body || {};
    const role = request.user.role;

    if (body.enabled !== undefined && role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Включать/выключать API может только ADMIN' });
    }

    const allowed = [
      'enabled', 'kwords', 'kwords_minus', 'f', 'actual', 'day',
      'enrich_max_age_months', 'price1', 'price2', 'page_limit'
    ];
    const patch = {};
    for (const k of allowed) {
      if (body[k] !== undefined) patch[k] = body[k];
    }

    const settings = await saveTenderGuruSettings(db, patch, request.user.id);
    return { settings };
  });

  fastify.post('/registry/tenderguru/sync', {
    preHandler: [fastify.requireRoles(['ADMIN', 'HEAD_TO'])]
  }, async (request, reply) => {
    const force = request.user.role === 'ADMIN' && request.body?.force === true;
    try {
      const result = await runTenderGuruSync(db, fastify.log, { force });
      if (result.skipped && result.reason === 'disabled' && !force) {
        return reply.code(409).send({ error: 'TenderGuru API выключен. ADMIN может force=true', result });
      }
      broadcast('tender:registry:changed', { source: 'tenderguru' });
      return { result };
    } catch (e) {
      return reply.code(500).send({ error: e.message });
    }
  });

  fastify.get('/registry/tenderguru/test', {
    preHandler: [fastify.requireRoles(['ADMIN', 'TO', 'HEAD_TO'])]
  }, async (request, reply) => {
    const settings = await loadTenderGuruSettings(db);
    if (!settings.api_key_set) {
      return reply.code(400).send({ error: 'TENDERGURU_API_KEY не задан на сервере' });
    }
    const { searchTenders } = require('../services/tenderguru-client');
    const r = await searchTenders({
      apiKey: process.env.TENDERGURU_API_KEY,
      kwords: settings.kwords,
      kwords_minus: settings.kwords_minus,
      f: settings.f,
      actual: settings.actual,
      day: settings.day,
      price1: settings.price1,
      price2: settings.price2,
      page_limit: 3
    });
    return { ok: !r.error, total: r.total, sample: r.items.slice(0, 3), error: r.error || null };
  });

  // GET /morning-brief — ежедневное напоминание ТО / РП при входе
  fastify.get('/morning-brief', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request) => {
    const { getCurrentDuty } = require('../services/tender-registry-helpers');
    const user = request.user;
    const role = user.role || '';
    const uid = user.id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const brief = {
      role,
      date: today.toISOString().slice(0, 10),
      to: null,
      pm: null
    };

    const isTo = ['TO', 'HEAD_TO', 'ADMIN'].includes(role);
    const isPm = ['PM', 'HEAD_PM', 'ADMIN'].includes(role);

    if (isTo) {
      // Для HEAD_TO/ADMIN — общеотдельная сводка; для TO — только свои
      const scopeSql = role === 'TO'
        ? 'AND (t.created_by_user_id = $1 OR t.created_by = $1 OR t.calculator_user_id = $1)'
        : '';
      const params = role === 'TO' ? [uid] : [];
      const waitingReport = await db.query(`
        SELECT t.id, t.customer_name, t.tender_title, t.docs_deadline, t.registry_status,
               t.responsible_pm_id, pm.name AS pm_name, pm.email AS pm_email,
               r.analysis_finalized_at, r.is_final, r.calculator_user_id
        FROM tenders t
        LEFT JOIN tender_rp_reviews r ON r.tender_id = t.id
        LEFT JOIN users pm ON pm.id = COALESCE(t.responsible_pm_id, t.calculator_user_id)
        WHERE t.deleted_at IS NULL
          AND COALESCE(t.registry_status, 'рассмотрение') IN ('рассмотрение', 'готовим')
          AND t.docs_deadline IS NOT NULL
          AND t.docs_deadline::date <= CURRENT_DATE + INTERVAL '5 days'
          AND t.docs_deadline::date >= CURRENT_DATE
          AND (r.analysis_finalized_at IS NULL OR r.id IS NULL)
          ${scopeSql}
        ORDER BY t.docs_deadline ASC
        LIMIT 50
      `, params);

      const readyNoSubmit = await db.query(`
        SELECT t.id, t.customer_name, t.tender_title, t.docs_deadline, t.registry_status,
               r.is_final, r.analysis_finalized_at, r.work_price, r.work_price_ex_vat
        FROM tenders t
        JOIN tender_rp_reviews r ON r.tender_id = t.id
        WHERE t.deleted_at IS NULL
          AND COALESCE(t.registry_status, 'рассмотрение') IN ('рассмотрение', 'готовим')
          AND (r.is_final = true OR r.analysis_finalized_at IS NOT NULL)
          ${scopeSql}
        ORDER BY t.docs_deadline ASC NULLS LAST
        LIMIT 50
      `, params);

      const needAssign = await db.query(`
        SELECT t.id, t.customer_name, t.tender_title, t.docs_deadline, t.calculator_user_id,
               r.analysis_finalized_at, r.is_final
        FROM tenders t
        JOIN tender_rp_reviews r ON r.tender_id = t.id
        WHERE t.deleted_at IS NULL
          AND COALESCE(t.registry_status, 'рассмотрение') = 'рассмотрение'
          AND r.analysis_finalized_at IS NOT NULL
          AND COALESCE(r.is_final, false) = false
          AND t.calculator_user_id IS NULL
          ${scopeSql}
        ORDER BY t.docs_deadline ASC NULLS LAST
        LIMIT 50
      `, params);

      brief.to = {
        waiting_report: waitingReport.rows,
        ready_no_submit: readyNoSubmit.rows,
        need_assign: needAssign.rows
      };
    }

    if (isPm) {
      const duty = await getCurrentDuty(db, today);
      let dutyAnalysis = [];
      if (duty && Number(duty.pm_user_id) === Number(uid)) {
        const periodEnd = duty.period_end;
        const r = await db.query(`
          SELECT t.id, t.customer_name, t.tender_title, t.docs_deadline, t.registry_status
          FROM tenders t
          LEFT JOIN tender_rp_reviews r ON r.tender_id = t.id
          WHERE t.deleted_at IS NULL
            AND COALESCE(t.registry_status, 'рассмотрение') = 'рассмотрение'
            AND t.docs_deadline IS NOT NULL
            AND t.docs_deadline::date >= $1::date
            AND t.docs_deadline::date <= ($2::date + INTERVAL '2 days')
            AND (r.analysis_finalized_at IS NULL OR r.id IS NULL)
          ORDER BY t.docs_deadline ASC
          LIMIT 80
        `, [duty.period_start, periodEnd]);
        dutyAnalysis = r.rows;
      }

      const myCalcs = await db.query(`
        SELECT t.id, t.customer_name, t.tender_title, t.docs_deadline, r.is_final, r.analysis_finalized_at
        FROM tenders t
        JOIN tender_rp_reviews r ON r.tender_id = t.id
        WHERE t.deleted_at IS NULL
          AND t.calculator_user_id = $1
          AND COALESCE(r.is_final, false) = false
          AND COALESCE(t.registry_status, 'рассмотрение') IN ('рассмотрение', 'готовим')
        ORDER BY t.docs_deadline ASC NULLS LAST
        LIMIT 50
      `, [uid]);

      let kanban = { waiting: 0, in_work: 0, overdue: 0, critical: [] };
      try {
        const pk = await db.query(`
          SELECT id, current_main_status AS status, entity_id, entity_kind, flow_type, is_closed, last_moved_at
          FROM personal_kanban_cards
          WHERE owner_user_id = $1
            AND flow_type = 'application'
            AND COALESCE(is_closed, false) = false
          ORDER BY last_moved_at ASC NULLS LAST
          LIMIT 100
        `, [uid]);
        const stuckMs = 5 * 86400000;
        const now = Date.now();
        for (const c of pk.rows) {
          const col = String(c.status || '').toLowerCase();
          if (/wait|ожид|new|нов|incoming|inbox|очеред/.test(col)) kanban.waiting++;
          else kanban.in_work++;
          const moved = c.last_moved_at ? new Date(c.last_moved_at).getTime() : 0;
          if (moved && (now - moved) > stuckMs) {
            kanban.overdue++;
            if (kanban.critical.length < 10) {
              kanban.critical.push({
                id: c.id,
                title: `${c.entity_kind} #${c.entity_id}`,
                status: c.status
              });
            }
          }
        }
      } catch (_e) {
        // personal_kanban schema may vary — soft-fail
      }

      brief.pm = {
        is_duty: !!(duty && Number(duty.pm_user_id) === Number(uid)),
        duty: duty || null,
        duty_analysis: dutyAnalysis,
        my_calcs: myCalcs.rows,
        kanban
      };
    }

    const hasTo = brief.to && (
      brief.to.waiting_report.length || brief.to.ready_no_submit.length || brief.to.need_assign.length
    );
    const hasPm = brief.pm && (
      (brief.pm.duty_analysis && brief.pm.duty_analysis.length) ||
      (brief.pm.my_calcs && brief.pm.my_calcs.length) ||
      (brief.pm.kanban && (brief.pm.kanban.waiting || brief.pm.kanban.overdue))
    );

    return { ...brief, show: !!(hasTo || hasPm) };
  });

  // POST /morning-brief/nudge-email — ТО шлёт batch-письмо РП по тендерам без отчёта
  fastify.post('/morning-brief/nudge-email', {
    preHandler: [fastify.requireRoles(['ADMIN', 'TO', 'HEAD_TO'])]
  }, async (request, reply) => {
    const ids = Array.isArray(request.body?.tender_ids) ? request.body.tender_ids.map(Number).filter(Boolean) : [];
    if (!ids.length) return reply.code(400).send({ error: 'Укажите tender_ids' });
    const { sendCrmEmail } = require('../services/crm-mailer');

    const r = await db.query(`
      SELECT t.id, t.customer_name, t.tender_title, t.docs_deadline,
             COALESCE(pm.email, calc.email) AS email,
             COALESCE(pm.name, calc.name) AS pm_name
      FROM tenders t
      LEFT JOIN users pm ON pm.id = t.responsible_pm_id
      LEFT JOIN users calc ON calc.id = t.calculator_user_id
      WHERE t.id = ANY($1::int[]) AND t.deleted_at IS NULL
    `, [ids]);

    const byEmail = new Map();
    for (const row of r.rows) {
      if (!row.email) continue;
      if (!byEmail.has(row.email)) byEmail.set(row.email, { name: row.pm_name, items: [] });
      byEmail.get(row.email).items.push(row);
    }

    let sent = 0;
    const errors = [];
    for (const [email, pack] of byEmail.entries()) {
      const list = pack.items.map((t) =>
        `#${t.id} ${t.customer_name || ''} — дедлайн ${t.docs_deadline || '—'}`
      ).join('\n');
      try {
        await sendCrmEmail(db, request.user.id, {
          to: email,
          subject: `[АСГАРД] Нужны отчёты по ${pack.items.length} тендерам`,
          text: `Здравствуйте${pack.name ? ', ' + pack.name : ''}!\n\nПросим ускорить анализ/отчёт по тендерам:\n\n${list}\n\n— Тендерный отдел АСГАРД CRM`
        });
        sent++;
      } catch (e) {
        errors.push({ email, error: e.message });
      }
    }
    return { sent, recipients: byEmail.size, errors };
  });
}

module.exports = routes;
