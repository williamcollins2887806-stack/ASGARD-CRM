'use strict';
/**
 * Очередь market_ai_jobs: assign_key | photo | description | category_retry.
 * AI/enqueue ошибки не должны ронять intake счёта.
 */

const BLOCKED_KEY = 'market_ai_blocked_until';
const BUDGET_KEY = 'market_ai_daily_budget_rub';
const MAX_PHOTOS_KEY = 'market_ai_max_photos';
const DEFAULT_BUDGET = 500;
const DEFAULT_MAX_PHOTOS = 500;

async function getSettingJson(db, key) {
  try {
    const { rows } = await db.query('SELECT value_json FROM settings WHERE key=$1 LIMIT 1', [key]);
    if (!rows[0]) return null;
    let raw = rows[0].value_json;
    try {
      raw = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (_) {}
    return raw;
  } catch (_) {
    return null;
  }
}

async function upsertSettingJson(db, key, value) {
  const payload = JSON.stringify(value);
  const upd = await db.query(
    'UPDATE settings SET value_json=$1, updated_at=NOW() WHERE key=$2',
    [payload, key]
  );
  if (upd.rowCount === 0) {
    await db.query('INSERT INTO settings (key, value_json) VALUES ($1,$2)', [key, payload]);
  }
}

async function isMarketAiBlocked(db) {
  const until = await getSettingJson(db, BLOCKED_KEY);
  if (!until) return false;
  const ts = Date.parse(String(until));
  if (!Number.isFinite(ts)) return false;
  if (Date.now() < ts) return true;
  try {
    await upsertSettingJson(db, BLOCKED_KEY, null);
  } catch (_) {}
  // unblock jobs
  try {
    await db.query(
      `UPDATE market_ai_jobs SET status='pending', next_run_at=NOW(), updated_at=NOW()
       WHERE status='blocked'`
    );
  } catch (_) {}
  return false;
}

async function blockMarketAi(db, hours = 24) {
  const until = new Date(Date.now() + hours * 3600 * 1000).toISOString();
  await upsertSettingJson(db, BLOCKED_KEY, until);
  await db.query(
    `UPDATE market_ai_jobs SET status='blocked', next_run_at=$1::timestamptz, updated_at=NOW()
     WHERE status IN ('pending','running') AND job_type IN ('photo','description')`,
    [until]
  );
  return until;
}

async function getDailyBudgetRub(db) {
  const v = await getSettingJson(db, BUDGET_KEY);
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_BUDGET;
}

async function getMaxPhotos(db) {
  const v = await getSettingJson(db, MAX_PHOTOS_KEY);
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_PHOTOS;
}

async function countReadyHeroes(db) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM market_card_archetypes
     WHERE hero_photo_url IS NOT NULL AND btrim(hero_photo_url)<>''`
  );
  return rows[0]?.n || 0;
}

/**
 * @param {object} db
 * @param {{entityType, entityId?, archetypeKey?, jobType, payload?}} opts
 */
async function enqueueJob(db, opts = {}) {
  const entityType = String(opts.entityType || '').trim();
  const jobType = String(opts.jobType || '').trim();
  if (!entityType || !jobType) return null;
  const entityId = opts.entityId != null ? Number(opts.entityId) : null;
  const archetypeKey = opts.archetypeKey ? String(opts.archetypeKey) : null;
  const payload = opts.payload && typeof opts.payload === 'object' ? opts.payload : {};

  // dedupe: один pending на сущность.
  // ВАЖНО: для product+description нельзя схлопывать по archetype_key —
  // иначе 7 новых позиций Офисмага получают 1 описание на всех (03.11.2026).
  let exist = { rows: [] };
  if (Number.isFinite(entityId)) {
    exist = await db.query(
      `SELECT id FROM market_ai_jobs
       WHERE status IN ('pending','running','blocked')
         AND job_type=$1 AND entity_type=$2 AND entity_id=$3
       LIMIT 1`,
      [jobType, entityType, entityId]
    );
  } else if (archetypeKey) {
    exist = await db.query(
      `SELECT id FROM market_ai_jobs
       WHERE status IN ('pending','running','blocked')
         AND job_type=$1 AND entity_type=$2 AND archetype_key=$3
         AND entity_id IS NULL
       LIMIT 1`,
      [jobType, entityType, archetypeKey]
    );
  }
  if (exist.rows[0]) return exist.rows[0];

  const { rows } = await db.query(
    `INSERT INTO market_ai_jobs(entity_type, entity_id, archetype_key, job_type, status, payload, next_run_at)
     VALUES($1,$2,$3,$4,'pending',$5::jsonb,NOW())
     RETURNING *`,
    [
      entityType,
      Number.isFinite(entityId) ? entityId : null,
      archetypeKey,
      jobType,
      JSON.stringify(payload),
    ]
  );
  return rows[0] || null;
}

/** После create товара: key + photo/description jobs. Ошибки глотаются. */
async function afterProductCreated(db, product, extras = {}) {
  try {
    const archetype = require('./market-card-archetype');
    const { isMarketplaceGroup, classifyProductGroup } = require('./product-category-classify');
    let searchGroup = product.search_group || extras.search_group || null;
    if (!searchGroup && product.id) {
      try {
        const { rows } = await db.query(
          `SELECT c.search_group FROM products p
           LEFT JOIN product_categories c ON c.id = p.category_id WHERE p.id=$1`,
          [product.id]
        );
        searchGroup = rows[0]?.search_group || null;
      } catch (_) {}
    }
    if (!searchGroup) {
      searchGroup = classifyProductGroup({
        name: product.name || extras.name,
        unit: product.unit || extras.unit,
        supplierName: extras.supplierName,
      });
    }
    // Жильё / питание / услуги — в номенклатуру да, на витрину и в AI-карточку нет
    if (!isMarketplaceGroup(searchGroup)) {
      if (!product.category_id && extras.needCategoryRetry) {
        await enqueueJob(db, {
          entityType: 'product',
          entityId: product.id,
          jobType: 'category_retry',
          payload: { name: product.name || extras.name, unit: product.unit || extras.unit },
        });
      }
      return { skipped: true, reason: 'non_marketplace', search_group: searchGroup };
    }
    const row = {
      name: product.name || extras.name,
      unit: product.unit || extras.unit,
      search_group: searchGroup,
      brand: product.brand || extras.brand,
      model: product.model || extras.model,
    };
    const m = await archetype.assignProductCardKey(db, product.id, row);
    let arch = await archetype.ensureArchetype(db, {
      key: m.key,
      title: m.title,
      prompt_hint: m.title,
    });
    const needsPhoto =
      !arch?.hero_photo_url ||
      !arch.photo_source ||
      arch.photo_source === 'placeholder';
    if (needsPhoto) {
      try {
        const photo = require('./market-card-photo');
        if (!arch?.hero_photo_url || arch.photo_source === 'placeholder' || !arch.photo_source) {
          await photo.applyPlaceholderToArchetype(
            db,
            m.key,
            m.title,
            row.search_group || m.key.split('_')[0]
          );
        }
      } catch (e) {
        console.warn('[market-ai-jobs] placeholder:', e.message);
      }
      await enqueueJob(db, {
        entityType: 'archetype',
        archetypeKey: m.key,
        jobType: 'photo',
        payload: { product_id: product.id, upgrade_placeholder: true },
      });
    }
    await enqueueJob(db, {
      entityType: 'product',
      entityId: product.id,
      archetypeKey: m.key,
      jobType: 'description',
      payload: { name: row.name },
    });
    if (!product.category_id && extras.needCategoryRetry) {
      await enqueueJob(db, {
        entityType: 'product',
        entityId: product.id,
        jobType: 'category_retry',
        payload: { name: row.name, unit: row.unit },
      });
    }
    return m;
  } catch (e) {
    console.warn('[market-ai-jobs] afterProductCreated:', e.message);
    return null;
  }
}

async function claimJobs(db, limit = 15) {
  const blocked = await isMarketAiBlocked(db);
  const { rows } = await db.query(
    `UPDATE market_ai_jobs j SET status='running', attempts=attempts+1, updated_at=NOW()
     WHERE j.id IN (
       SELECT id FROM market_ai_jobs
       WHERE status='pending'
         AND next_run_at <= NOW()
         AND ($2::bool = false OR job_type NOT IN ('photo','description'))
       ORDER BY
         CASE job_type
           WHEN 'assign_key' THEN 1
           WHEN 'category_retry' THEN 2
           WHEN 'photo' THEN 3
           WHEN 'description' THEN 4
           ELSE 5
         END,
         created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [Math.max(1, Math.min(50, Number(limit) || 15)), blocked]
  );
  return rows;
}

async function markDone(db, jobId, extra = {}) {
  await db.query(
    `UPDATE market_ai_jobs SET status='done', last_error=NULL, updated_at=NOW(),
       payload = CASE WHEN $2::jsonb IS NULL THEN payload ELSE payload || $2::jsonb END
     WHERE id=$1`,
    [jobId, extra && Object.keys(extra).length ? JSON.stringify(extra) : null]
  );
}

async function markFailed(db, jobId, errMsg, retryMinutes = 30) {
  const attempts = await db.query(`SELECT attempts FROM market_ai_jobs WHERE id=$1`, [jobId]);
  const n = attempts.rows[0]?.attempts || 1;
  if (n >= 5) {
    await db.query(
      `UPDATE market_ai_jobs SET status='failed', last_error=$2, updated_at=NOW() WHERE id=$1`,
      [jobId, String(errMsg || 'failed').slice(0, 2000)]
    );
    return;
  }
  await db.query(
    `UPDATE market_ai_jobs SET status='pending', last_error=$2,
       next_run_at=NOW() + ($3 || ' minutes')::interval, updated_at=NOW()
     WHERE id=$1`,
    [jobId, String(errMsg || 'failed').slice(0, 2000), String(retryMinutes)]
  );
}

module.exports = {
  enqueueJob,
  afterProductCreated,
  claimJobs,
  markDone,
  markFailed,
  isMarketAiBlocked,
  blockMarketAi,
  getDailyBudgetRub,
  getMaxPhotos,
  countReadyHeroes,
  getSettingJson,
  upsertSettingJson,
  BLOCKED_KEY,
  BUDGET_KEY,
  MAX_PHOTOS_KEY,
};
