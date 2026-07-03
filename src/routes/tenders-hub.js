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
 * Контракт см. pipeline/investigations/INV-4.md §2 (унифицированная схема).
 * Зависимость: V250 миграция (tenders.source_kind колонка с CHECK 7 значений).
 *
 * S-13.3 (gap-fix): +4 поля связи tender→work (work_id, work_code, work_pm_name,
 * work_status). Для tenders — LEFT JOIN works w ON tender_id=t.id AND work_kind='main'
 * AND deleted_at IS NULL + users wu ON wu.id=w.pm_id. Для pre_tender_requests —
 * та же цепочка через pt.created_tender_id. inbox/calls — NULL (отдельной сессией,
 * слишком длинная цепочка для UNION). Итого 19 полей унифицированной схемы.
 *
 * Query params:
 *   tab     — tenders | applications | all (default: all)
 *   subtab  — platforms | in_work | mail | phone | pm (default: '' = all of tab)
 *   period  — 3d | 7d | 30d | year | all (default: all)
 *   search  — ILIKE по customer_name + title + tender_number + customer_inn
 *   status  — фильтр по tender_status (применяется только к tender-источнику)
 *   type    — фильтр по tender_type (только tender)
 *   source  — фильтр по source_kind/source (применяется к tender)
 *   resp    — 'me' или числовой user_id (responsible_pm_id/calculator_user_id)
 *   limit   — 1..200 (default 50)
 *   offset  — 0+ (default 0)
 *
 * RBAC:
 *   ADMIN, DIRECTOR_GEN/COMM/DEV, HEAD_TO, HEAD_PM — видят всё
 *   PM   — tenders: responsible_pm_id OR work_assigned_pm_id OR works.pm_id
 *          pre_tender: assigned_to OR created_by
 *          inbox: assigned_pm_id
 *          calls: user_id (с ai_is_target)
 *   TO   — tenders: calculator_user_id OR created_by_user_id
 *          pre_tender: assigned_to OR created_by
 *          inbox: assigned_pm_id (пусто для TO в типовых данных)
 *          calls: user_id (свои входящие)
 *   BUH  — ничего не возвращаем (нет ролевого scope для feed)
 *
 * Response:
 *   { items: [...], total: N, limit, offset, role, tab, subtab, period }
 */

'use strict';

const DIRECTOR_LIKE_ROLES = ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','HEAD_TO','HEAD_PM'];
const ALLOWED_ROLES = ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','HEAD_TO','HEAD_PM','TO','PM'];

async function routes(fastify, opts) {
  const db = fastify.db;

  // ─────────────────────────────────────────────────────────────────────────
  // GET /api/tenders-hub/feed
  // ─────────────────────────────────────────────────────────────────────────
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

    // period → SQL interval
    let periodInterval = null;
    if (period === '3d')   periodInterval = '3 days';
    else if (period === '7d')   periodInterval = '7 days';
    else if (period === '30d')  periodInterval = '30 days';
    else if (period === 'year') periodInterval = '1 year';

    // resp → null | user_id (int)
    let respUserId = null;
    if (respRaw === 'me') respUserId = user.id;
    else if (respRaw && !isNaN(parseInt(respRaw, 10))) respUserId = parseInt(respRaw, 10);

    const isDirectorLike = DIRECTOR_LIKE_ROLES.includes(user.role);
    const isPM = user.role === 'PM';
    const isTO = user.role === 'TO';

    // Что включать в UNION
    const wantTenders = (tab === 'all' || tab === 'tenders');
    const wantApps    = (tab === 'all' || tab === 'applications');

    // subtab фильтрация на уровне tab='tenders': platforms (источник с площадки/почты)
    // / in_work (активные в работе ТО). Для tab='applications' subtab выбирает mail/phone/pm.
    const tenderSubtabPlatforms = (subtab === 'platforms' || subtab === '');
    const tenderSubtabInWork    = (subtab === 'in_work'   || subtab === '');
    const appSubtabMail  = (subtab === 'mail'  || subtab === '');
    const appSubtabPhone = (subtab === 'phone' || subtab === '');
    const appSubtabPm    = (subtab === 'pm'    || subtab === '');

    // params — общий массив для всех UNION-частей.
    const params = [];
    const sqls = [];

    // ─── 1. tenders ──────────────────────────────────────────────────────
    if (wantTenders && (tenderSubtabPlatforms || tenderSubtabInWork)) {
      // Стаб-tenders «Auto-tender для pt-N» создаются legacy-скриптами как
      // placeholders для pre_tender'ов. Они НЕ должны попадать на вкладку
      // «Тендеры» в Хабе — для них есть отдельная вкладка «Заявки», где
      // pre_tender_requests UNION'ятся напрямую. (Уже фильтруются в:
      // mimir-tkp-quick.js:948, conductor.js:614, letter-generator.js:349.)
      const w = [
        't.deleted_at IS NULL',
        "(t.tender_title IS NULL OR t.tender_title NOT ILIKE 'Auto-tender%')"
      ];
      if (periodInterval) {
        params.push(periodInterval);
        w.push(`t.created_at >= NOW() - $${params.length}::interval`);
      }
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
        // 23.06.2026 BUG-FIX (P0 #4): колонки `t.source` в schema нет (только `source_kind`).
        // До фикса работало на проде только из-за ручного ALTER (schema-drift), на чистом клоне
        // запрос валился `column does not exist`.
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
        // 23.06.2026 BUG-FIX (P0 #4): колонки `tender_number` в схеме нет (есть только `tender_title`).
        w.push(`(t.customer_name ILIKE $${s} OR t.tender_title ILIKE $${s} OR t.customer_inn ILIKE $${s})`);
      }
      sqls.push(`
        SELECT
          t.id::int                                       AS id,
          'tender'::text                                  AS kind,
          -- 23.06.2026 BUG-FIX (P0 #4 + N1): убраны несуществующие в схеме t.source, t.customer, t.tender_number.
          -- До фикса хаб тендеров на чистой БД валился ERROR 42703 column does not exist; на проде работало
          -- только благодаря ручному ALTER (schema-drift).
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
        LEFT JOIN users wu
          ON wu.id = w.pm_id
        WHERE ${w.join(' AND ')}
      `);
    }

    // ─── 2. pre_tender_requests ──────────────────────────────────────────
    if (wantApps && appSubtabPm) {
      const w = ["pt.status <> 'expired'"];
      if (periodInterval) {
        params.push(periodInterval);
        w.push(`pt.created_at >= NOW() - $${params.length}::interval`);
      }
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
          -- source_type в БД: 'email'|'manual'|'platform'. Маппим в коды
          -- которые знает frontend (см. SOURCE_LABELS в tenders.js:417):
          -- email → email_request (📧 Письмо), manual → pm_manual (👤 От РП),
          -- platform → platform (📡 Площадки).
          CASE pt.source_type
            WHEN 'email'    THEN 'email_request'
            WHEN 'manual'   THEN 'pm_manual'
            WHEN 'platform' THEN 'platform'
            ELSE 'email_request'
          END::text                                       AS source_label,
          pt.customer_name::text                          AS customer_name,
          pt.customer_inn::text                           AS customer_inn,
          LEFT(COALESCE(pt.work_description, ''), 200)::text AS title,
          -- pre_tender_request status (англ.) → русский лейбл для UI, который
          -- ожидает наглядные tender_status-подобные значения.
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
          END::text                                       AS status,
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
        LEFT JOIN users wu
          ON wu.id = w.pm_id
        WHERE ${w.join(' AND ')}
      `);
    }

    // ─── 3. inbox_applications ───────────────────────────────────────────
    if (wantApps && appSubtabMail) {
      // Показываем ТОЛЬКО необработанные письма. Когда РП принял заявку и
      // создал pre_tender_request — inbox_app получает статус assigned/accepted
      // и должен исчезнуть с этой вкладки (он уже видим на subtab 'От РП' как
      // pre_tender). Иначе одна заявка дублируется в двух подвкладках.
      const w = [
        "ia.status <> 'archived'",
        "ia.status NOT IN ('assigned','accepted','converted','rejected')"
      ];
      if (periodInterval) {
        params.push(periodInterval);
        w.push(`ia.created_at >= NOW() - $${params.length}::interval`);
      }
      if (isPM) {
        // §INV-4 риск #1: в /api/inbox-applications нет RBAC, но в feed применяем.
        params.push(user.id);
        w.push(`ia.assigned_pm_id = $${params.length}`);
      } else if (isTO) {
        // TO не работает с inbox_applications — не показываем.
        params.push(-1);
        w.push(`1 = $${params.length}`); // никогда не true
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
          ia.source_kind::text                            AS source_label,
          -- Заказчик: customer_name (заполняется вручную) →
          -- extracted_customer_name (AI вытащил из текста) →
          -- original_sender_name (если это прямой клиент без форварда) →
          -- source_name/email (переслатель — последний fallback).
          COALESCE(
            NULLIF(ia.customer_name, ''),
            NULLIF(ia.extracted_customer_name, ''),
            NULLIF(ia.original_sender_name, ''),
            NULLIF(ia.source_name, ''),
            ia.source_email
          )::text                                         AS customer_name,
          COALESCE(NULLIF(ia.customer_inn, ''), NULLIF(ia.extracted_customer_inn, ''))::text AS customer_inn,
          LEFT(COALESCE(ia.subject, ''), 200)::text       AS title,
          ia.status::text                                 AS status,
          ia.ai_work_type::text                           AS type_label,
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

    // ─── 4. call_history (target, не конвертированные) ───────────────────
    if (wantApps && appSubtabPhone) {
      const w = ['ch.ai_is_target = true', 'ch.lead_id IS NULL'];
      if (periodInterval) {
        params.push(periodInterval);
        w.push(`ch.created_at >= NOW() - $${params.length}::interval`);
      }
      // call_history имеет RBAC через telephony.js: !TEL_ADMIN_ROLES → ch.user_id=$u.
      // В feed применяем тот же scope (PM/TO/HEAD_TO видят только свои).
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
          'target'::text                                  AS status,
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

    if (sqls.length === 0) {
      return { items: [], total: 0, limit, offset, role: user.role, tab, subtab, period };
    }

    const innerSql = sqls.join('\nUNION ALL\n');

    // Count (total для пагинации)
    const countSql = `SELECT COUNT(*)::int AS total FROM (${innerSql}) AS feed`;
    const countParams = params.slice(); // копия для COUNT — те же params
    const countRes = await db.query(countSql, countParams);
    const total = parseInt(countRes.rows[0]?.total || 0, 10);

    // Data с ORDER BY + LIMIT/OFFSET (новые params для пагинации)
    params.push(limit, offset);
    const dataSql = `
      SELECT * FROM (${innerSql}) AS feed
      ORDER BY event_at DESC NULLS LAST, id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;

    const dataRes = await db.query(dataSql, params);
    return {
      items: dataRes.rows,
      total,
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
