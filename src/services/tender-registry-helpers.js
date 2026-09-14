/**
 * Helpers for tender registry (TO first tier)
 */

const REGISTRY_STATUSES = ['рассмотрение', 'готовим', 'подались', 'проиграли', 'отмена', 'выиграли'];

const REGISTRY_TO_TENDER_STATUS = {
  'рассмотрение': 'Новый',
  'готовим': 'На анализе',
  'подались': 'КП отправлено',
  'выиграли': 'Выиграли',
  'проиграли': 'Проиграли',
  'отмена': 'Не подходит'
};

const TENDER_TO_REGISTRY_STATUS = {
  'Новый': 'рассмотрение',
  'Черновик': 'рассмотрение',
  'На анализе': 'готовим',
  'Отправлено на просчёт': 'готовим',
  'Согласование ТКП': 'готовим',
  'ТКП согласовано': 'готовим',
  'Готово к отправке КП': 'готовим',
  'КП отправлено': 'подались',
  'Дозапрос': 'подались',
  'Выиграли': 'выиграли',
  'Проиграли': 'проиграли',
  'Не подходит': 'отмена'
};

function syncTenderStatus(registryStatus) {
  return REGISTRY_TO_TENDER_STATUS[registryStatus] || 'Новый';
}

function syncRegistryStatus(tenderStatus) {
  return TENDER_TO_REGISTRY_STATUS[tenderStatus] || null;
}

// registry_status — источник истины нового реестра. legacy tender_status не трогаем,
// если анализ уже закрыт: syncTenderStatus('готовим') = 'На анализе' откатывал бы статус назад.
function tenderStatusUpdateFor(registryStatus, analysisFinalized) {
  if (registryStatus === 'готовим' && analysisFinalized) return null;
  return syncTenderStatus(registryStatus);
}

/** Обновляет registry_status; tender_status пишет только если это не откат назад. */
async function applyRegistryStatus(db, tenderId, registryStatus, analysisFinalized) {
  const ts = tenderStatusUpdateFor(registryStatus, analysisFinalized);
  if (ts) {
    await db.query(
      `UPDATE tenders SET registry_status = $1, tender_status = $2, updated_at = NOW()
       WHERE id = $3 AND registry_status NOT IN ('отмена', 'проиграли')`,
      [registryStatus, ts, tenderId]
    );
  } else {
    await db.query(
      `UPDATE tenders SET registry_status = $1, updated_at = NOW()
       WHERE id = $2 AND registry_status NOT IN ('отмена', 'проиграли')`,
      [registryStatus, tenderId]
    );
  }
}

const KANBAN_REGISTRY_STATUSES = new Set(['готовим', 'подались']);

/** Строки, которые не показываем в реестре ТО и дежурной очереди РП */
function notGarbageInEitherColumn(alias, pattern) {
  return `(LOWER(COALESCE(${alias}.tender_title, '')) NOT LIKE ${pattern} AND LOWER(COALESCE(${alias}.customer_name, '')) NOT LIKE ${pattern})`;
}

function buildRegistryExclusionClause(alias = 't', createdByAlias = null) {
  const p = alias;
  const parts = [
    `${p}.source_pre_tender_id IS NULL`,
    notGarbageInEitherColumn(p, `'st-%'`),
    notGarbageInEitherColumn(p, `'%auto-tender%'`),
    `LOWER(COALESCE(${p}.comment_to, '')) NOT LIKE '%авто-tender из pre_tender%'`,
    `LOWER(COALESCE(${p}.comment_to, '')) NOT LIKE '%создано из заявки #%'`,
    `LOWER(COALESCE(${p}.comment_to, '')) NOT LIKE '%быстрый путь из заявки%'`,
    notGarbageInEitherColumn(p, `'%<script%'`),
    notGarbageInEitherColumn(p, `'%javascript:%'`),
    notGarbageInEitherColumn(p, `'%<iframe%'`),
    notGarbageInEitherColumn(p, `'%<embed%'`),
    notGarbageInEitherColumn(p, `'%admin-matrix%'`),
    notGarbageInEitherColumn(p, `'%conc-8 race%'`),
    notGarbageInEitherColumn(p, `'%audit-3 update%'`),
    notGarbageInEitherColumn(p, `'%&#60;script%'`),
    notGarbageInEitherColumn(p, `'%&lt;script%'`),
    `NOT (LOWER(COALESCE(${p}.customer_name, '')) = 'новый заказчик' AND LOWER(COALESCE(${p}.tender_title, '')) IN ('', 'новый тендер'))`,
    `NOT (TRIM(COALESCE(${p}.customer_name, '')) = '' AND LOWER(COALESCE(${p}.tender_title, '')) = 'новый тендер')`,
    `NOT (LOWER(COALESCE(${p}.customer_name, '')) IN ('ооо "валидация"', 'ооо "кавычки & <теги>"'))`
  ];
  if (createdByAlias) {
    parts.push(`LOWER(COALESCE(${createdByAlias}.name, '')) NOT LIKE 'test %'`);
  }
  return ' AND ' + parts.map((x) => `(${x})`).join(' AND ');
}

async function ensureTenderKanbanCard(db, tenderId, ownerUserId) {
  if (!ownerUserId || !tenderId) return null;
  try {
    const pk = require('../routes/personal-kanban');
    const t = await db.query('SELECT tender_status FROM tenders WHERE id = $1', [tenderId]);
    const mainStatus = t.rows[0]?.tender_status || 'Новый';
    const subId = await pk.ensureDefaultSubstages(db, ownerUserId, 'tender', mainStatus);
    const ins = await db.query(`
      INSERT INTO personal_kanban_cards
        (owner_user_id, flow_type, entity_kind, entity_id, current_main_status, current_substage_id)
      VALUES ($1, 'tender', 'tender', $2, $3, $4)
      ON CONFLICT (owner_user_id, entity_kind, entity_id)
        DO UPDATE SET
          current_main_status = EXCLUDED.current_main_status,
          current_substage_id = COALESCE(EXCLUDED.current_substage_id, personal_kanban_cards.current_substage_id),
          is_closed = false,
          updated_at = NOW()
      RETURNING id
    `, [ownerUserId, tenderId, mainStatus, subId]);
    return ins.rows[0]?.id || null;
  } catch (_) {
    return null;
  }
}

function isValidRegistryStatus(s) {
  return REGISTRY_STATUSES.includes(s);
}

async function writeRegistryAudit(db, { actorUserId, tenderId, action, before, after, field }) {
  try {
    await db.query(`
      INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, payload_json, created_at)
      VALUES ($1, 'tender', $2, $3, $4, NOW())
    `, [actorUserId, tenderId, action, JSON.stringify({ field, before, after })]);
  } catch (_) { /* non-fatal */ }
}

/** Запись в историю тендера: TenderGuru API заполнил/изменил поля */
async function writeTenderGuruEnrichAudit(db, { tenderId, changes }) {
  if (!changes?.length) return;
  try {
    await db.query(`
      INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, payload_json, created_at)
      VALUES (NULL, 'tender', $1, 'tenderguru_enrich', $2, NOW())
    `, [tenderId, JSON.stringify({ source: 'tenderguru', changes })]);
  } catch (_) { /* non-fatal */ }
}

async function writeReviewLog(db, { reviewId, tenderId, actorUserId, action, payload }) {
  await db.query(`
    INSERT INTO tender_rp_review_log (review_id, tender_id, actor_user_id, action, payload_json)
    VALUES ($1, $2, $3, $4, $5)
  `, [reviewId, tenderId, actorUserId, action, JSON.stringify(payload || {})]);
}

async function ensureReview(db, tenderId, actorUserId) {
  let r = await db.query('SELECT * FROM tender_rp_reviews WHERE tender_id = $1', [tenderId]);
  if (r.rows[0]) {
    // Backfill analysis_owner ONLY from started_by (never from arbitrary viewer)
    if (!r.rows[0].analysis_owner_user_id && r.rows[0].started_by_user_id) {
      try {
        const u = await db.query(`
          UPDATE tender_rp_reviews
          SET analysis_owner_user_id = COALESCE(analysis_owner_user_id, started_by_user_id)
          WHERE id = $1 AND analysis_owner_user_id IS NULL
          RETURNING *
        `, [r.rows[0].id]);
        if (u.rows[0]) return u.rows[0];
      } catch (_) { /* column may not exist before migration */ }
    }
    return r.rows[0];
  }
  // Empty shell row — ownership назначается при первой записи дежурного/хозяина
  // ON CONFLICT: параллельные GET не должны ронять 500 (duplicate tender_id)
  try {
    r = await db.query(`
      INSERT INTO tender_rp_reviews (tender_id, updated_at)
      VALUES ($1, NOW())
      ON CONFLICT (tender_id) DO UPDATE SET updated_at = tender_rp_reviews.updated_at
      RETURNING *
    `, [tenderId]);
    return r.rows[0];
  } catch (err) {
    if (err && (err.code === '23505' || /on conflict/i.test(String(err.message || '')))) {
      r = await db.query('SELECT * FROM tender_rp_reviews WHERE tender_id = $1', [tenderId]);
      if (r.rows[0]) return r.rows[0];
      // ON CONFLICT unsupported (no unique) — plain insert + reselect
      r = await db.query(`
        INSERT INTO tender_rp_reviews (tender_id, updated_at)
        VALUES ($1, NOW()) RETURNING *
      `, [tenderId]);
      return r.rows[0];
    }
    throw err;
  }
}

async function getCurrentDuty(db, date = new Date()) {
  const d = date.toISOString().slice(0, 10);
  const r = await db.query(`
    SELECT r.*,
           u.name AS pm_name,
           ab.name AS assigned_by_name
    FROM pm_duty_roster r
    JOIN users u ON u.id = r.pm_user_id
    JOIN users ab ON ab.id = r.assigned_by_user_id
    WHERE r.period_start <= $1::date AND r.period_end >= $1::date
    ORDER BY r.created_at DESC
    LIMIT 1
  `, [d]);
  return r.rows[0] || null;
}

async function computeCustomerScore(db, customerInn, customerName) {
  const key = customerInn || customerName;
  if (!key) return null;
  const cond = customerInn
    ? 'customer_inn = $1'
    : 'customer_name ILIKE $1 AND (customer_inn IS NULL OR customer_inn = \'\')';
  const val = customerInn || customerName;
  const r = await db.query(`
    SELECT
      COUNT(*)::int AS tenders_count,
      COUNT(*) FILTER (WHERE registry_status = 'выиграли')::int AS wins,
      COUNT(*) FILTER (WHERE registry_status = 'проиграли')::int AS losses,
      COUNT(*) FILTER (WHERE registry_status = 'отмена')::int AS cancels
    FROM tenders
    WHERE deleted_at IS NULL AND ${cond}
  `, [val]);
  const row = r.rows[0] || { tenders_count: 0, wins: 0, losses: 0, cancels: 0 };
  const decided = row.wins + row.losses;
  let win_chance_pct = 50;
  if (decided > 0) {
    win_chance_pct = Math.round((row.wins / decided) * 100);
    if (row.tenders_count >= 5) win_chance_pct = Math.min(95, win_chance_pct + 5);
  } else if (row.tenders_count === 0) {
    win_chance_pct = 50;
  } else {
    win_chance_pct = 40;
  }
  const reasons = await db.query(`
    SELECT reject_reason, COUNT(*)::int AS cnt
    FROM tenders
    WHERE deleted_at IS NULL AND reject_reason IS NOT NULL AND reject_reason != ''
      AND ${cond}
    GROUP BY reject_reason
    ORDER BY cnt DESC
    LIMIT 5
  `, [val]);
  return {
    ...row,
    win_chance_pct,
    top_reject_reasons: reasons.rows.map(x => ({ reason: x.reject_reason, count: x.cnt }))
  };
}

module.exports = {
  REGISTRY_STATUSES,
  REGISTRY_TO_TENDER_STATUS,
  TENDER_TO_REGISTRY_STATUS,
  KANBAN_REGISTRY_STATUSES,
  syncTenderStatus,
  syncRegistryStatus,
  tenderStatusUpdateFor,
  applyRegistryStatus,
  isValidRegistryStatus,
  writeRegistryAudit,
  writeTenderGuruEnrichAudit,
  writeReviewLog,
  ensureReview,
  getCurrentDuty,
  computeCustomerScore,
  ensureTenderKanbanCard,
  buildRegistryExclusionClause
};
