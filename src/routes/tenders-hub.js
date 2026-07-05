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

/** period query param → SQL date filter fragments (push params into array). */
function applyPeriodFilter(tableAlias, createdCol, period, params) {
  if (period === '3d') {
    params.push('3 days');
    return `${tableAlias}.${createdCol} >= NOW() - $${params.length}::interval`;
  }
  if (period === '7d') {
    params.push('7 days');
    return `${tableAlias}.${createdCol} >= NOW() - $${params.length}::interval`;
  }
  if (period === '30d') {
    params.push('30 days');
    return `${tableAlias}.${createdCol} >= NOW() - $${params.length}::interval`;
  }
  if (period === 'year') {
    params.push('1 year');
    return `${tableAlias}.${createdCol} >= NOW() - $${params.length}::interval`;
  }
  if (period.startsWith('year:')) {
    const y = parseInt(period.slice(5), 10);
    if (Number.isFinite(y) && y > 2000 && y < 2100) {
      params.push(`${y}-01-01`);
      params.push(`${y + 1}-01-01`);
      const a = params.length - 1;
      const b = params.length;
      return `${tableAlias}.${createdCol} >= $${a}::date AND ${tableAlias}.${createdCol} < $${b}::date`;
    }
  }
  if (/^\d{4}-\d{2}$/.test(period)) {
    params.push(period);
    const p = params.length;
    return `${tableAlias}.${createdCol} >= ($${p} || '-01')::date AND ${tableAlias}.${createdCol} < (($${p} || '-01')::date + interval '1 month')`;
  }
  return null;
}

/**
 * Собирает UNION ALL для feed.
 * @returns {{ sqls: string[], params: unknown[] }}
 */
function buildFeedParts({
  tab, subtab, period, search, status, typeStr, source, respUserId,
  user, isDirectorLike, isPM, isTO
}) {
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
    const periodClause = applyPeriodFilter('t', 'created_at', period, params);
    if (periodClause) w.push(periodClause);
    if (isPM) {
      params.push(user.id);
      const u = params.length;
      w.push(`(t.responsible_pm_id = $${u} OR t.work_assigned_pm_id = $${u} OR EXISTS (SELECT 1 FROM works wk WHERE wk.tender_id = t.id AND wk.pm_id = $${u}))`);
    } else if (isTO) {
      params.push(user.id);
      const u = params.length;
      w.push(`(t.calculator_user_id = $${u} OR t.created_by_user_id = $${u})`);
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
      const periodClause = applyPeriodFilter('pt', 'created_at', period, params);
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
          wu.name::text                                   AS work_pm_name,
          w.work_status::text                             AS work_status
        FROM pre_tender_requests pt
        LEFT JOIN tenders tch ON tch.id = pt.created_tender_id
        LEFT JOIN works w
          ON w.tender_id = tch.id
         AND w.work_kind = 'main'
         AND w.deleted_at IS NULL
        LEFT JOIN users wu ON wu.id = w.pm_id
        WHERE ${w.join(' AND ')}
      `);
    }
  }

  // ─── 3. inbox_applications (subtab mail) ─────────────────────────────
  if (wantApps && appSubtabMail) {
    const w = [
      "ia.status <> 'archived'",
      "ia.status NOT IN ('assigned','accepted','converted','rejected')"
    ];
    const periodClause = applyPeriodFilter('ia', 'created_at', period, params);
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
        NULL::text                                      AS work_pm_name,
        NULL::text                                      AS work_status
      FROM inbox_applications ia
      WHERE ${w.join(' AND ')}
    `);
  }

  // ─── 4. call_history (subtab phone) ──────────────────────────────────
  if (wantApps && appSubtabPhone) {
    const w = ['ch.ai_is_target = true', 'ch.lead_id IS NULL'];
    const periodClause = applyPeriodFilter('ch', 'created_at', period, params);
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
    const search  = (q.search || '').toString().slice(0, 200).replace(/\0/g, '');
    const status  = (q.status || '').toString().slice(0, 100);
    const typeStr = (q.type   || '').toString().slice(0, 100);
    const source  = (q.source || '').toString().slice(0, 100);
    const respRaw = (q.resp   || '').toString();
    const limit   = Math.max(1, Math.min(200, parseInt(q.limit, 10) || 50));
    const offset  = Math.max(0, parseInt(q.offset, 10) || 0);

    let respUserId = null;
    if (respRaw === 'me') respUserId = user.id;
    else if (respRaw && !isNaN(parseInt(respRaw, 10))) respUserId = parseInt(respRaw, 10);

    const isDirectorLike = DIRECTOR_LIKE_ROLES.includes(user.role);
    const isPM = user.role === 'PM';
    const isTO = user.role === 'TO';

    const ctx = {
      tab, subtab, period, search, status, typeStr, source, respUserId,
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
}

module.exports = routes;
