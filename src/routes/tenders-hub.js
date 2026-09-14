/**
 * Tenders-Hub Feed Endpoint
 * ───────────────────────────────────────────────────────────────────────────
 * GET /api/tenders-hub/feed — единый агрегатор для главной страницы «Хаба
 * Тендеров» (заменяет Сагу). UNION ALL по 4 источникам:
 *   1. tenders — основной реестр тендеров
 *   2. pre_tender_requests — заявки на просчёт (от РП или из почты)
 *   3. inbox_applications — входящие заявки на почте
 *   4. call_history — целевые звонки (ai_is_target=true), ещё не конвертированные
 *      в тендер (lead_id IS NULL)
 *
 * Sub-tabs заявок (tab=applications):
 *   mail  — inbox (необработанные) + pre_tender source_type=email
 *   phone — call_history + pre_tender source_type=phone
 *   pm    — pre_tender source_type=manual (ручной ввод РП)
 *
 * Response:
 *   { items, total, applications_total, all_total, subtab_counts, ... }
 */

'use strict';

const { buildTenderDateWhere } = require('../services/tender-date-filter');

const DIRECTOR_LIKE_ROLES = ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','HEAD_TO','HEAD_PM'];
const ALLOWED_ROLES = ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','HEAD_TO','HEAD_PM','TO','PM'];

const PT_SOURCE_LABEL_SQL = `
  CASE pt.source_type
    WHEN 'email'    THEN 'email_request'
    WHEN 'manual'   THEN 'pm_manual'
    WHEN 'platform' THEN 'platform'
    WHEN 'phone'    THEN 'phone'
    WHEN 'meeting'  THEN 'pm_manual'
    WHEN 'referral' THEN 'pm_manual'
    WHEN 'website'  THEN 'pm_manual'
    WHEN 'other'    THEN 'pm_manual'
    ELSE 'email_request'
  END::text`;

const PT_STATUS_LABEL_SQL = `
  CASE pt.status
    WHEN 'new'              THEN 'Новая заявка'
    WHEN 'in_review'        THEN 'На рассмотрении'
    WHEN 'need_docs'        THEN 'Запрошены документы'
    WHEN 'pending_approval' THEN 'Ждёт согласования'
    WHEN 'approved'         THEN 'Согласована'
    WHEN 'accepted'         THEN 'Принята'
    WHEN 'rejected'         THEN 'Отклонена'
    WHEN 'pending_payment'  THEN 'Ждёт оплаты'
    WHEN 'paid'             THEN 'Оплачена'
    ELSE pt.status
  END::text`;

const INBOX_STATUS_LABEL_SQL = `
  CASE ia.status
    WHEN 'new'           THEN 'Новая'
    WHEN 'ai_processed'  THEN 'AI обработана'
    WHEN 'under_review'  THEN 'На проверке'
    WHEN 'assigned'      THEN 'Назначена'
    WHEN 'accepted'      THEN 'Принята'
    WHEN 'rejected'      THEN 'Отклонена'
    WHEN 'archived'      THEN 'Архив'
    ELSE ia.status
  END::text`;

function applyPeriodFilter(tableAlias, createdCol, period, params, dateQuery = {}) {
  return buildTenderDateWhere(tableAlias, {
    period,
    date_from: dateQuery.date_from,
    date_to: dateQuery.date_to,
    date_field: dateQuery.date_field,
  }, params, { createdCol });
}

/**
 * Собирает UNION ALL для feed.
 * @returns {{ sqls: string[], params: unknown[] }}
 */
function buildFeedParts({
  tab, subtab, period, search, status, typeStr, source, respUserId,
  date_from, date_to, date_field,
  user, isDirectorLike, isPM, isTO
}) {
  const dateQuery = { date_from, date_to, date_field };
  const wantTenders = (tab === 'all' || tab === 'tenders');
  const wantApps    = (tab === 'all' || tab === 'applications');

  const tenderSubtabPlatforms = (subtab === 'platforms' || subtab === '');
  const tenderSubtabInWork    = (subtab === 'in_work'   || subtab === '');
  const appSubtabMail  = (subtab === 'mail'  || subtab === '');
  const appSubtabPhone = (subtab === 'phone' || subtab === '');
  const appSubtabPm    = (subtab === 'pm'    || subtab === '');

  const dedupPreTenderOnAll = (tab === 'all');

  const params = [];
  const sqls = [];

  // ─── 1. tenders ──────────────────────────────────────────────────────
  if (wantTenders && (tenderSubtabPlatforms || tenderSubtabInWork)) {
    const w = [
      't.deleted_at IS NULL',
      "(t.tender_title IS NULL OR t.tender_title NOT ILIKE 'Auto-tender%')"
    ];
    const periodClause = applyPeriodFilter('t', 'created_at', period, params, dateQuery);
    if (periodClause) w.push(periodClause);
    if (isPM) {
      params.push(user.id);
      const u = params.length;
      w.push(`(t.responsible_pm_id = $${u} OR t.work_assigned_pm_id = $${u} OR EXISTS (SELECT 1 FROM works wk WHERE wk.tender_id = t.id AND wk.pm_id = $${u}))`);
    }
    if (status) {
      params.push(status);
      w.push(`t.tender_status = $${params.length}`);
    }
    if (typeStr) {
      params.push(typeStr);
      w.push(`t.tender_type = $${params.length}`);
    }
    if (source) {
      params.push(source);
      w.push(`t.source_kind = $${params.length}`);
    }
    if (respUserId) {
      params.push(respUserId);
      const u = params.length;
      w.push(`(t.responsible_pm_id = $${u} OR t.work_assigned_pm_id = $${u} OR t.calculator_user_id = $${u} OR t.created_by_user_id = $${u})`);
    }
    if (search) {
      params.push(`%${search}%`);
      const s = params.length;
      w.push(`(t.customer_name ILIKE $${s} OR t.tender_title ILIKE $${s} OR t.customer_inn ILIKE $${s})`);
    }
    sqls.push(`
      SELECT
        t.id::int                                       AS id,
        'tender'::text                                  AS kind,
        COALESCE(t.source_kind, 'manual')::text         AS source_label,
        t.customer_name::text                           AS customer_name,
        t.customer_inn::text                            AS customer_inn,
        t.tender_title::text                            AS title,
        t.tender_status::text                           AS status,
        t.tender_type::text                             AS type_label,
        CASE WHEN t.docs_deadline IS NULL THEN NULL
             ELSE (t.docs_deadline - CURRENT_DATE)::int END AS deadline_days,
        t.tender_price::numeric                         AS nmck,
        COALESCE(t.responsible_pm_id, t.work_assigned_pm_id)::int AS responsible_user_id,
        NULL::numeric                                   AS ai_confidence,
        (t.tender_status = 'Дозапрос')::boolean         AS addendum_flag,
        0::int                                          AS docs_count,
        t.created_at::timestamp                         AS event_at,
        w.id::int                                       AS work_id,
        CASE WHEN w.id IS NOT NULL
             THEN ('W-' || w.id::text) ELSE NULL END::text AS work_code,
        wu.name::text                                   AS work_pm_name,
        w.work_status::text                             AS work_status
      FROM tenders t
      LEFT JOIN works w
        ON w.tender_id = t.id
       AND w.work_kind = 'main'
       AND w.deleted_at IS NULL
      LEFT JOIN users wu ON wu.id = w.pm_id
      WHERE ${w.join(' AND ')}
    `);
  }

  // ─── 2. pre_tender_requests (по каналу subtab) ───────────────────────
  const wantPreTender = wantApps && (appSubtabMail || appSubtabPhone || appSubtabPm);
  if (wantPreTender) {
    const sourceTypes = [];
    if (appSubtabMail)  sourceTypes.push('email');
    if (appSubtabPhone) sourceTypes.push('phone');
    if (appSubtabPm)    sourceTypes.push('manual');

    if (sourceTypes.length) {
      const w = ["pt.status <> 'expired'"];
      if (sourceTypes.length === 1) {
        params.push(sourceTypes[0]);
        w.push(`pt.source_type = $${params.length}`);
      } else {
        params.push(sourceTypes);
        w.push(`pt.source_type = ANY($${params.length}::text[])`);
      }
      if (dedupPreTenderOnAll) {
        w.push(`(pt.created_tender_id IS NULL OR pt.status NOT IN ('accepted', 'approved', 'paid'))`);
      }
      const periodClause = applyPeriodFilter('pt', 'created_at', period, params, dateQuery);
      if (periodClause) w.push(periodClause);
      if (isPM || isTO) {
        params.push(user.id);
        const u = params.length;
        w.push(`(pt.assigned_to = $${u} OR pt.created_by = $${u})`);
      }
      if (search) {
        params.push(`%${search}%`);
        const s = params.length;
        w.push(`(pt.customer_name ILIKE $${s} OR pt.work_description ILIKE $${s} OR pt.customer_inn ILIKE $${s})`);
      }
      sqls.push(`
        SELECT
          pt.id::int                                      AS id,
          'pre_tender'::text                              AS kind,
          ${PT_SOURCE_LABEL_SQL}                          AS source_label,
          pt.customer_name::text                          AS customer_name,
          pt.customer_inn::text                           AS customer_inn,
          LEFT(COALESCE(pt.work_description, ''), 200)::text AS title,
          ${PT_STATUS_LABEL_SQL}                          AS status,
          'Заявка'::text                                  AS type_label,
          CASE WHEN pt.work_deadline IS NULL THEN NULL
               ELSE (pt.work_deadline - CURRENT_DATE)::int END AS deadline_days,
          pt.estimated_sum::numeric                       AS nmck,
          pt.assigned_to::int                             AS responsible_user_id,
          pt.ai_confidence::numeric                       AS ai_confidence,
          false::boolean                                  AS addendum_flag,
          (CASE WHEN pt.has_documents THEN 1 ELSE 0 END)::int AS docs_count,
          pt.created_at::timestamp                        AS event_at,
          w.id::int                                       AS work_id,
          CASE WHEN w.id IS NOT NULL
               THEN ('W-' || w.id::text) ELSE NULL END::text AS work_code,
          COALESCE(wu.name, au.name)::text                AS work_pm_name,
          w.work_status::text                             AS work_status
        FROM pre_tender_requests pt
        LEFT JOIN tenders tch ON tch.id = pt.created_tender_id
        LEFT JOIN works w
          ON w.tender_id = tch.id
         AND w.work_kind = 'main'
         AND w.deleted_at IS NULL
        LEFT JOIN users wu ON wu.id = w.pm_id
        LEFT JOIN users au ON au.id = pt.assigned_to
        WHERE ${w.join(' AND ')}
      `);
    }
  }

  // ─── 3. inbox_applications (subtab mail) ─────────────────────────────
  if (wantApps && appSubtabMail) {
    // Для руководства / HEAD_*: показываем и уже назначенные на РП заявки.
    // Для PM/TO — только «живые» в inbox (ещё не у РП), иначе дубль с канбаном.
    const w = isDirectorLike
      ? ["ia.status <> 'archived'", "ia.status NOT IN ('converted','rejected')"]
      : [
          "ia.status <> 'archived'",
          "ia.status NOT IN ('assigned','accepted','converted','rejected')"
        ];
    const periodClause = applyPeriodFilter('ia', 'created_at', period, params, dateQuery);
    if (periodClause) w.push(periodClause);
    if (isPM) {
      params.push(user.id);
      w.push(`ia.assigned_pm_id = $${params.length}`);
    } else if (isTO) {
      params.push(-1);
      w.push(`1 = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      const s = params.length;
      w.push(`(ia.subject ILIKE $${s} OR ia.source_email ILIKE $${s} OR ia.source_name ILIKE $${s})`);
    }
    sqls.push(`
      SELECT
        ia.id::int                                      AS id,
        'application'::text                             AS kind,
        COALESCE(NULLIF(ia.source_kind, ''), 'email_request')::text AS source_label,
        COALESCE(
          NULLIF(ia.customer_name, ''),
          NULLIF(ia.extracted_customer_name, ''),
          NULLIF(ia.original_sender_name, ''),
          NULLIF(ia.source_name, ''),
          ia.source_email
        )::text                                         AS customer_name,
        COALESCE(NULLIF(ia.customer_inn, ''), NULLIF(ia.extracted_customer_inn, ''))::text AS customer_inn,
        LEFT(COALESCE(ia.subject, ''), 200)::text       AS title,
        ${INBOX_STATUS_LABEL_SQL}                       AS status,
        COALESCE(NULLIF(ia.ai_work_type, ''), 'Заявка')::text AS type_label,
        NULL::int                                       AS deadline_days,
        NULL::numeric                                   AS nmck,
        ia.assigned_pm_id::int                          AS responsible_user_id,
        ia.ai_confidence::numeric                       AS ai_confidence,
        false::boolean                                  AS addendum_flag,
        ia.attachment_count::int                        AS docs_count,
        ia.created_at::timestamp                        AS event_at,
        NULL::int                                       AS work_id,
        NULL::text                                      AS work_code,
        au.name::text                                   AS work_pm_name,
        NULL::text                                      AS work_status
      FROM inbox_applications ia
      LEFT JOIN users au ON au.id = ia.assigned_pm_id
      WHERE ${w.join(' AND ')}
    `);
  }

  // ─── 4. call_history (subtab phone) ──────────────────────────────────
  if (wantApps && appSubtabPhone) {
    const w = ['ch.ai_is_target = true', 'ch.lead_id IS NULL'];
    const periodClause = applyPeriodFilter('ch', 'created_at', period, params, dateQuery);
    if (periodClause) w.push(periodClause);
    if (!isDirectorLike || user.role === 'HEAD_TO') {
      params.push(user.id);
      w.push(`ch.user_id = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      const s = params.length;
      w.push(`(ch.from_number ILIKE $${s} OR ch.to_number ILIKE $${s} OR ch.ai_summary ILIKE $${s})`);
    }
    sqls.push(`
      SELECT
        ch.id::int                                      AS id,
        'call'::text                                    AS kind,
        'phone'::text                                   AS source_label,
        COALESCE(c.name, ch.from_number)::text          AS customer_name,
        ch.client_inn::text                             AS customer_inn,
        LEFT(COALESCE(ch.ai_summary, ''), 200)::text    AS title,
        'Целевой звонок'::text                          AS status,
        NULL::text                                      AS type_label,
        NULL::int                                       AS deadline_days,
        NULL::numeric                                   AS nmck,
        ch.user_id::int                                 AS responsible_user_id,
        NULL::numeric                                   AS ai_confidence,
        false::boolean                                  AS addendum_flag,
        0::int                                          AS docs_count,
        ch.created_at::timestamp                        AS event_at,
        NULL::int                                       AS work_id,
        NULL::text                                      AS work_code,
        NULL::text                                      AS work_pm_name,
        NULL::text                                      AS work_status
      FROM call_history ch
      LEFT JOIN customers c ON c.inn = ch.client_inn
      WHERE ${w.join(' AND ')}
    `);
  }

  return { sqls, params };
}

async function countFeed(db, ctx, tab, subtab) {
  const { sqls, params } = buildFeedParts({ ...ctx, tab, subtab });
  if (!sqls.length) return 0;
  const innerSql = sqls.join('\nUNION ALL\n');
  const countRes = await db.query(
    `SELECT COUNT(*)::int AS total FROM (${innerSql}) AS feed`,
    params.slice()
  );
  return parseInt(countRes.rows[0]?.total || 0, 10);
}

async function routes(fastify, opts) {
  const db = fastify.db;

  fastify.get('/feed', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    const user = req.user || {};
    if (!ALLOWED_ROLES.includes(user.role)) {
      return reply.code(403).send({ error: 'forbidden_role', role: user.role });
    }

    const q = req.query || {};
    const tab     = (q.tab    || 'all').toString();
    const subtab  = (q.subtab || '').toString();
    const period  = (q.period || 'all').toString();
    const date_from = q.date_from;
    const date_to = q.date_to;
    const date_field = q.date_field;
    const search  = (q.search || '').toString().slice(0, 200).replace(/\0/g, '');
    const status  = (q.status || '').toString().slice(0, 100);
    const typeStr = (q.type   || '').toString().slice(0, 100);
    const source  = (q.source || '').toString().slice(0, 100);
    const respRaw = (q.resp   || '').toString();
    const limit   = Math.max(1, Math.min(500, parseInt(q.limit, 10) || 50));
    const offset  = Math.max(0, parseInt(q.offset, 10) || 0);

    let respUserId = null;
    if (respRaw === 'me') respUserId = user.id;
    else if (respRaw && !isNaN(parseInt(respRaw, 10))) respUserId = parseInt(respRaw, 10);

    const isDirectorLike = DIRECTOR_LIKE_ROLES.includes(user.role);
    const isPM = user.role === 'PM';
    const isTO = user.role === 'TO';

    const ctx = {
      tab, subtab, period, search, status, typeStr, source, respUserId,
      date_from, date_to, date_field,
      user, isDirectorLike, isPM, isTO
    };

    const { sqls, params } = buildFeedParts(ctx);

    const emptyResponse = {
      items: [],
      total: 0,
      applications_total: 0,
      all_total: 0,
      subtab_counts: { mail: 0, phone: 0, pm: 0 },
      limit,
      offset,
      role: user.role,
      tab,
      subtab,
      period
    };

    if (sqls.length === 0) {
      const [applicationsTotal, allTotal, mailCnt, phoneCnt, pmCnt] = await Promise.all([
        countFeed(db, ctx, 'applications', ''),
        countFeed(db, ctx, 'all', ''),
        countFeed(db, ctx, 'applications', 'mail'),
        countFeed(db, ctx, 'applications', 'phone'),
        countFeed(db, ctx, 'applications', 'pm')
      ]);
      return {
        ...emptyResponse,
        applications_total: applicationsTotal,
        all_total: allTotal,
        subtab_counts: { mail: mailCnt, phone: phoneCnt, pm: pmCnt }
      };
    }

    const innerSql = sqls.join('\nUNION ALL\n');

    const countParams = params.slice();
    const countRes = await db.query(
      `SELECT COUNT(*)::int AS total FROM (${innerSql}) AS feed`,
      countParams
    );
    const total = parseInt(countRes.rows[0]?.total || 0, 10);

    params.push(limit, offset);
    const dataSql = `
      SELECT * FROM (${innerSql}) AS feed
      ORDER BY event_at DESC NULLS LAST, id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    const dataRes = await db.query(dataSql, params);

    const [applicationsTotal, allTotal, mailCnt, phoneCnt, pmCnt] = await Promise.all([
      countFeed(db, ctx, 'applications', ''),
      countFeed(db, ctx, 'all', ''),
      countFeed(db, ctx, 'applications', 'mail'),
      countFeed(db, ctx, 'applications', 'phone'),
      countFeed(db, ctx, 'applications', 'pm')
    ]);

    return {
      items: dataRes.rows,
      total,
      applications_total: applicationsTotal,
      all_total: allTotal,
      subtab_counts: { mail: mailCnt, phone: phoneCnt, pm: pmCnt },
      limit,
      offset,
      role: user.role,
      tab,
      subtab,
      period
    };
  });

  /**
   * GET /funnel-apps — агрегатор режима «Заявки» воронки хаба.
   * marketplace: свободные pre_tender + inbox (как director-inbox)
   * kanban: карты personal-kanban scope=all|owner, flow ∈ application|pre_tender
   */
  fastify.get('/funnel-apps', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    const user = req.user || {};
    if (!ALLOWED_ROLES.includes(user.role)) {
      return reply.code(403).send({ error: 'forbidden_role', role: user.role });
    }

    const isDirectorLike = DIRECTOR_LIKE_ROLES.includes(user.role);
    const scope = isDirectorLike ? 'all' : 'owner';

    try {
      const marketplace = await loadFunnelMarketplace(db);
      const kanban = await loadFunnelKanban(db, user, scope);
      return {
        success: true,
        marketplace,
        kanban,
        columns: FUNNEL_APP_COLUMNS,
        scope,
        role: user.role,
        counts: {
          marketplace: marketplace.length,
          kanban: kanban.length,
          total: marketplace.length + kanban.length
        }
      };
    } catch (e) {
      req.log.error({ err: e }, '[tenders-hub] funnel-apps failed');
      return reply.code(500).send({ error: 'funnel_apps_failed', message: e.message });
    }
  });
}

const MARKETPLACE_CLAIMABLE = ['new', 'in_review', 'need_docs'];
const INBOX_FREE_STATUSES = ['new', 'ai_processed', 'under_review'];
const FUNNEL_APP_COLUMNS = [
  'marketplace', 'new', 'calc', 'approval', 'kp_prep', 'sent', 'addendum', 'win', 'lose', 'work'
];
const PK3_COLUMNS = ['new', 'calc', 'approval', 'kp_prep', 'sent', 'addendum', 'win', 'lose', 'work'];

function clipText(s, n) {
  const t = String(s || '').trim().replace(/\s+/g, ' ');
  if (!t) return '';
  if (t.length <= n) return t;
  return t.slice(0, Math.max(1, n - 1)) + '…';
}

function buildAppTitle(customerName, workTitle, fallbackId) {
  const c = String(customerName || '').trim();
  const w = clipText(workTitle, 80);
  if (c && w) return `${c} · ${w}`;
  if (c) return c;
  if (w) return w;
  return `Заявка #${fallbackId}`;
}

function normalizeManualDocs(manualDocuments, preTenderId) {
  let arr = manualDocuments;
  if (typeof arr === 'string') {
    try { arr = JSON.parse(arr); } catch (_) { arr = []; }
  }
  if (!Array.isArray(arr)) return [];
  return arr.map((d, idx) => ({
    kind: 'manual',
    id: d.id || idx,
    idx,
    filename: d.original_filename || d.filename || d.name || `Документ ${idx + 1}`,
    mime_type: d.mime_type || null,
    size: d.size || null,
    download_url: `/api/pre-tenders/${preTenderId}/documents/${idx}/download`
  }));
}

function normalizeEmailDocs(emailAttachments, preTenderId) {
  let arr = emailAttachments;
  if (typeof arr === 'string') {
    try { arr = JSON.parse(arr); } catch (_) { arr = []; }
  }
  if (!Array.isArray(arr)) return [];
  return arr.map((d) => ({
    kind: 'email',
    id: d.id,
    filename: d.original_filename || d.filename || `Вложение #${d.id}`,
    mime_type: d.mime_type || null,
    size: d.size || null,
    download_url: preTenderId
      ? `/api/pre-tenders/${preTenderId}/email-attachments/${d.id}/download`
      : null
  }));
}

async function loadFunnelMarketplace(db) {
  const ptRes = await db.query(
    `SELECT pt.id,
            pt.customer_name,
            pt.customer_inn,
            pt.customer_email,
            pt.contact_person,
            pt.contact_phone,
            pt.work_description,
            pt.ai_work_type,
            pt.work_deadline,
            pt.estimated_sum,
            pt.status,
            pt.source_type,
            pt.email_id,
            pt.created_at,
            pt.updated_at,
            pt.manual_documents,
            pt.has_documents,
            e.subject AS email_subject,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id', ea.id,
                'filename', ea.filename,
                'original_filename', ea.original_filename,
                'mime_type', ea.mime_type,
                'size', ea.size
              ) ORDER BY ea.id)
              FROM email_attachments ea WHERE ea.email_id = pt.email_id
            ), '[]'::jsonb) AS email_attachments,
            (SELECT COUNT(*)::int FROM email_attachments ea WHERE ea.email_id = pt.email_id) AS email_attachments_count
       FROM pre_tender_requests pt
       LEFT JOIN emails e ON e.id = pt.email_id
       LEFT JOIN tenders t ON t.source_pre_tender_id = pt.id
      WHERE pt.assigned_to IS NULL
        AND pt.status = ANY($1::text[])
        AND t.id IS NULL
      ORDER BY pt.created_at ASC
      LIMIT 300`,
    [MARKETPLACE_CLAIMABLE]
  );

  const inboxRes = await db.query(
    `SELECT ia.id,
            ia.subject,
            ia.source_name,
            ia.source_email,
            ia.extracted_customer_name,
            ia.extracted_customer_inn,
            ia.extracted_customer_contact_person,
            ia.extracted_customer_phone,
            ia.ai_summary,
            ia.ai_work_type,
            ia.status,
            ia.email_id,
            ia.attachment_count,
            ia.created_at,
            ia.updated_at,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id', ea.id,
                'filename', ea.filename,
                'original_filename', ea.original_filename,
                'mime_type', ea.mime_type,
                'size', ea.size
              ) ORDER BY ea.id)
              FROM email_attachments ea WHERE ea.email_id = ia.email_id
            ), '[]'::jsonb) AS email_attachments
       FROM inbox_applications ia
      WHERE ia.assigned_pm_id IS NULL
        AND ia.status = ANY($1::text[])
        AND NOT EXISTS (
          SELECT 1 FROM pre_tender_requests pt
           WHERE pt.email_id IS NOT NULL AND pt.email_id = ia.email_id
        )
      ORDER BY ia.created_at ASC
      LIMIT 300`,
    [INBOX_FREE_STATUSES]
  );

  const items = [];

  for (const pt of ptRes.rows) {
    const customer = pt.customer_name || null;
    const work = pt.work_description || pt.ai_work_type || pt.email_subject || null;
    const docs = [
      ...normalizeEmailDocs(pt.email_attachments, pt.id),
      ...normalizeManualDocs(pt.manual_documents, pt.id)
    ];
    items.push({
      kind: 'pre_tender',
      source_bucket: 'marketplace',
      funnel_column: 'marketplace',
      id: pt.id,
      entity_id: pt.id,
      card_id: null,
      customer_name: customer,
      customer_inn: pt.customer_inn || null,
      contact_person: pt.contact_person || null,
      contact_phone: pt.contact_phone || null,
      customer_email: pt.customer_email || null,
      work_title: clipText(work, 120) || null,
      work_description: pt.work_description || null,
      title: buildAppTitle(customer, work, pt.id),
      status: pt.status,
      source_label: pt.source_type || 'pre_tender',
      owner_name: null,
      owner_user_id: null,
      deadline: pt.work_deadline || null,
      estimated_sum: pt.estimated_sum != null ? Number(pt.estimated_sum) : null,
      docs_count: docs.length,
      documents: docs,
      created_at: pt.created_at,
      event_at: pt.created_at,
      last_moved_at: pt.updated_at || pt.created_at,
      open_hash: '#/director-inbox'
    });
  }

  for (const ia of inboxRes.rows) {
    const customer = ia.extracted_customer_name || null;
    const work = ia.ai_work_type || ia.ai_summary || ia.subject || null;
    const emailDocs = normalizeEmailDocs(ia.email_attachments, null).map((d) => ({
      ...d,
      download_url: `/api/inbox-applications/${ia.id}/attachments/${d.id}/download`
    }));
    items.push({
      kind: 'inbox',
      source_bucket: 'marketplace',
      funnel_column: 'marketplace',
      id: ia.id,
      entity_id: ia.id,
      card_id: null,
      customer_name: customer,
      customer_inn: ia.extracted_customer_inn || null,
      contact_person: ia.extracted_customer_contact_person || null,
      contact_phone: ia.extracted_customer_phone || null,
      customer_email: ia.source_email || null,
      work_title: clipText(work, 120) || null,
      work_description: ia.ai_summary || ia.subject || null,
      title: buildAppTitle(customer, work, ia.id),
      status: ia.status,
      source_label: 'inbox',
      owner_name: null,
      owner_user_id: null,
      deadline: null,
      estimated_sum: null,
      docs_count: emailDocs.length || Number(ia.attachment_count) || 0,
      documents: emailDocs,
      created_at: ia.created_at,
      event_at: ia.created_at,
      last_moved_at: ia.updated_at || ia.created_at,
      open_hash: '#/director-inbox'
    });
  }

  return items;
}

async function loadFunnelKanban(db, user, scope) {
  const where = [
    'c.is_closed = FALSE',
    `c.flow_type = ANY(ARRAY['application','pre_tender']::text[])`
  ];
  const params = [];
  if (scope === 'owner') {
    params.push(user.id);
    where.push(`c.owner_user_id = $${params.length}`);
  }

  let rows;
  try {
    const r = await db.query(
      `SELECT c.id AS card_id,
              c.owner_user_id,
              c.flow_type,
              c.entity_kind,
              c.entity_id,
              c.current_main_status,
              c.v3_column,
              c.last_moved_at,
              c.created_at,
              c.updated_at,
              u.name AS owner_name
         FROM v_unified_kanban_cards c
         LEFT JOIN users u ON u.id = c.owner_user_id
        WHERE ${where.join(' AND ')}
        ORDER BY c.v3_column, c.last_moved_at DESC NULLS LAST
        LIMIT 800`,
      params
    );
    rows = r.rows;
  } catch (e) {
    if (e && (e.code === '42P01' || /v_unified_kanban_cards/i.test(e.message || ''))) {
      return [];
    }
    throw e;
  }

  const ptIds = [];
  const iaIds = [];
  for (const row of rows) {
    if (row.entity_kind === 'pre_tender' && row.entity_id) ptIds.push(row.entity_id);
    if (row.entity_kind === 'inbox_application' && row.entity_id) iaIds.push(row.entity_id);
  }

  const ptMap = new Map();
  const iaMap = new Map();

  if (ptIds.length) {
    const ptRes = await db.query(
      `SELECT pt.id,
              pt.customer_name,
              pt.customer_inn,
              pt.customer_email,
              pt.contact_person,
              pt.contact_phone,
              pt.work_description,
              pt.ai_work_type,
              pt.work_deadline,
              pt.estimated_sum,
              pt.status,
              pt.source_type,
              pt.manual_documents,
              pt.email_id,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'id', ea.id,
                  'filename', ea.filename,
                  'original_filename', ea.original_filename,
                  'mime_type', ea.mime_type,
                  'size', ea.size
                ) ORDER BY ea.id)
                FROM email_attachments ea WHERE ea.email_id = pt.email_id
              ), '[]'::jsonb) AS email_attachments
         FROM pre_tender_requests pt
        WHERE pt.id = ANY($1::int[])`,
      [ptIds]
    );
    for (const row of ptRes.rows) ptMap.set(row.id, row);
  }

  if (iaIds.length) {
    const iaRes = await db.query(
      `SELECT ia.id,
              ia.subject,
              ia.source_name,
              ia.source_email,
              ia.extracted_customer_name,
              ia.extracted_customer_inn,
              ia.extracted_customer_contact_person,
              ia.extracted_customer_phone,
              ia.ai_summary,
              ia.ai_work_type,
              ia.status,
              ia.attachment_count,
              ia.email_id,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'id', ea.id,
                  'filename', ea.filename,
                  'original_filename', ea.original_filename,
                  'mime_type', ea.mime_type,
                  'size', ea.size
                ) ORDER BY ea.id)
                FROM email_attachments ea WHERE ea.email_id = ia.email_id
              ), '[]'::jsonb) AS email_attachments
         FROM inbox_applications ia
        WHERE ia.id = ANY($1::int[])`,
      [iaIds]
    );
    for (const row of iaRes.rows) iaMap.set(row.id, row);
  }

  const items = [];
  for (const row of rows) {
    const col = PK3_COLUMNS.includes(row.v3_column) ? row.v3_column : 'new';
    let customer = null;
    let work = null;
    let workDescription = null;
    let customerInn = null;
    let contactPerson = null;
    let contactPhone = null;
    let customerEmail = null;
    let deadline = null;
    let estimatedSum = null;
    let status = row.current_main_status;
    let sourceLabel = row.flow_type;
    let docs = [];
    let kind = row.entity_kind === 'inbox_application' ? 'inbox' : 'pre_tender';

    if (row.entity_kind === 'pre_tender') {
      const pt = ptMap.get(row.entity_id) || {};
      customer = pt.customer_name || null;
      work = pt.work_description || pt.ai_work_type || null;
      workDescription = pt.work_description || null;
      customerInn = pt.customer_inn || null;
      contactPerson = pt.contact_person || null;
      contactPhone = pt.contact_phone || null;
      customerEmail = pt.customer_email || null;
      deadline = pt.work_deadline || null;
      estimatedSum = pt.estimated_sum != null ? Number(pt.estimated_sum) : null;
      status = pt.status || status;
      sourceLabel = pt.source_type || 'pre_tender';
      docs = [
        ...normalizeEmailDocs(pt.email_attachments, pt.id),
        ...normalizeManualDocs(pt.manual_documents, pt.id)
      ];
    } else if (row.entity_kind === 'inbox_application') {
      const ia = iaMap.get(row.entity_id) || {};
      customer = ia.extracted_customer_name || null;
      work = ia.ai_work_type || ia.ai_summary || ia.subject || null;
      workDescription = ia.ai_summary || ia.subject || null;
      customerInn = ia.extracted_customer_inn || null;
      contactPerson = ia.extracted_customer_contact_person || null;
      contactPhone = ia.extracted_customer_phone || null;
      customerEmail = ia.source_email || null;
      status = ia.status || status;
      sourceLabel = 'inbox';
      docs = normalizeEmailDocs(ia.email_attachments, null).map((d) => ({
        ...d,
        download_url: `/api/inbox-applications/${ia.id}/attachments/${d.id}/download`
      }));
    }

    items.push({
      kind,
      source_bucket: 'kanban',
      funnel_column: col,
      id: row.entity_id,
      entity_id: row.entity_id,
      card_id: row.card_id,
      customer_name: customer,
      customer_inn: customerInn,
      contact_person: contactPerson,
      contact_phone: contactPhone,
      customer_email: customerEmail,
      work_title: clipText(work, 120) || null,
      work_description: workDescription,
      title: buildAppTitle(customer, work, row.entity_id || row.card_id),
      status,
      source_label: sourceLabel,
      owner_name: row.owner_name || null,
      owner_user_id: row.owner_user_id || null,
      deadline,
      estimated_sum: estimatedSum,
      docs_count: docs.length,
      documents: docs,
      v3_column: col,
      flow_type: row.flow_type,
      created_at: row.created_at,
      event_at: row.last_moved_at || row.created_at,
      last_moved_at: row.last_moved_at || row.created_at,
      open_hash: row.card_id ? `#/personal-kanban-v3?card=${row.card_id}` : '#/personal-kanban-v3'
    });
  }

  return items;
}

module.exports = routes;
