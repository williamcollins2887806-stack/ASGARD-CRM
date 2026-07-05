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

const KANBAN_REGISTRY_STATUSES = new Set(['готовим', 'подались']);

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
  if (r.rows[0]) return r.rows[0];
  r = await db.query(`
    INSERT INTO tender_rp_reviews (tender_id, started_by_user_id, updated_at)
    VALUES ($1, $2, NOW()) RETURNING *
  `, [tenderId, actorUserId || null]);
  return r.rows[0];
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
  isValidRegistryStatus,
  writeRegistryAudit,
  writeTenderGuruEnrichAudit,
  writeReviewLog,
  ensureReview,
  getCurrentDuty,
  computeCustomerScore,
  ensureTenderKanbanCard
};
