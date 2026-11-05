'use strict';
/**
 * Cron: обработка market_ai_jobs (photo / description / category_retry / assign_key).
 * Advisory lock; batch 10–20; NO_CREDIT → blocked_until +24ч.
 */
const db = require('./db');
const jobs = require('./market-ai-jobs');
const photo = require('./market-card-photo');
const archetype = require('./market-card-archetype');

const LOCK_KEY = 4502026; // unique advisory lock id for market AI
const INTERVAL_MS = 7 * 60 * 1000;
let timer = null;
let running = false;

async function tryLock() {
  const { rows } = await db.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY]);
  return !!rows[0]?.ok;
}

async function unlock() {
  try {
    await db.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
  } catch (_) {}
}

async function generateDescription(productId) {
  const descSvc = require('./market-card-description');
  return descSvc.generateEntityDescription(db, 'product', productId);
}

async function processJob(job) {
  const type = job.job_type;
  if (type === 'assign_key') {
    if (job.entity_type === 'product' && job.entity_id) {
      const { rows } = await db.query(
        `SELECT p.id, p.name, p.unit, c.search_group
         FROM products p LEFT JOIN product_categories c ON c.id=p.category_id
         WHERE p.id=$1`,
        [job.entity_id]
      );
      if (rows[0]) await archetype.assignProductCardKey(db, rows[0].id, rows[0]);
    } else if (job.entity_type === 'equipment' && job.entity_id) {
      const { rows } = await db.query(
        `SELECT id, name, brand, model FROM equipment WHERE id=$1`,
        [job.entity_id]
      );
      if (rows[0]) {
        await archetype.assignEquipmentCardKey(db, rows[0].id, {
          name: rows[0].name,
          brand: rows[0].brand,
          model: rows[0].model,
          search_group: 'equipment',
        });
      }
    }
    await jobs.markDone(db, job.id);
    return { type, ok: true };
  }

  if (type === 'category_retry' && job.entity_type === 'product' && job.entity_id) {
    const { resolveProductCategory } = require('./product-category-classify');
    const { rows } = await db.query(`SELECT id, name, unit, category_id FROM products WHERE id=$1`, [
      job.entity_id,
    ]);
    const p = rows[0];
    if (!p) {
      await jobs.markDone(db, job.id, { note: 'missing' });
      return { type, ok: true, skipped: true };
    }
    if (p.category_id) {
      await jobs.markDone(db, job.id, { note: 'already' });
      return { type, ok: true, skipped: true };
    }
    const resolved = await resolveProductCategory(db, {
      name: p.name,
      unit: p.unit,
      ...(job.payload || {}),
    });
    if (resolved.category_id) {
      const isCons = ['consumable', 'ppe', 'materials'].includes(resolved.group);
      await db.query(
        `UPDATE products SET category_id=$2,
           is_consumable = CASE WHEN $3 THEN true ELSE is_consumable END,
           updated_at=NOW()
         WHERE id=$1 AND category_id IS NULL`,
        [p.id, resolved.category_id, isCons]
      );
    }
    await jobs.markDone(db, job.id, { category_id: resolved.category_id || null });
    return { type, ok: true, category_id: resolved.category_id || null };
  }

  if (type === 'photo') {
    const key = job.archetype_key || (job.payload && job.payload.archetype_key);
    if (!key) {
      await jobs.markFailed(db, job.id, 'no archetype_key');
      return { type, ok: false };
    }
    const r = await photo.generateArchetypePhoto(db, key);
    if (r.reason === 'blocked' || r.reason === 'max_photos') {
      await db.query(
        `UPDATE market_ai_jobs SET status='blocked', last_error=$2, next_run_at=NOW()+interval '6 hours', updated_at=NOW()
         WHERE id=$1`,
        [job.id, r.reason]
      );
      return { type, ok: false, reason: r.reason };
    }
    if (!r.ok && !r.skipped) {
      await jobs.markFailed(db, job.id, r.reason || 'photo_failed');
      return { type, ok: false, reason: r.reason };
    }
    await jobs.markDone(db, job.id, { url: r.url, cost_rub: r.cost_rub || 0 });
    return { type, ok: true, ...r };
  }

  if (type === 'description' && job.entity_id) {
    const descSvc = require('./market-card-description');
    const et = job.entity_type === 'equipment' ? 'equipment' : 'product';
    const r = await descSvc.generateEntityDescription(db, et, job.entity_id);
    await jobs.markDone(db, job.id, { skipped: !!r.skipped, chars: r.chars || 0 });
    return { type, ok: true, ...r };
  }

  await jobs.markFailed(db, job.id, `unsupported ${type}/${job.entity_type}`);
  return { type, ok: false };
}

async function tick(limit = 15) {
  if (running) return { skipped: true, reason: 'reentrant' };
  running = true;
  const stats = { claimed: 0, done: 0, failed: 0, cost: 0, photos: 0, blocked: false };
  try {
    const got = await tryLock();
    if (!got) return { skipped: true, reason: 'lock' };

    if (await jobs.isMarketAiBlocked(db)) {
      stats.blocked = true;
    }

    const batch = await jobs.claimJobs(db, limit);
    stats.claimed = batch.length;
    for (const job of batch) {
      try {
        const r = await processJob(job);
        if (r.ok) {
          stats.done++;
          if (r.cost_rub) stats.cost += Number(r.cost_rub) || 0;
          if (r.url && !r.skipped) stats.photos++;
        } else {
          stats.failed++;
        }
      } catch (e) {
        if (e.code === 'NO_CREDIT') {
          await jobs.blockMarketAi(db, 24);
          stats.blocked = true;
          await db.query(
            `UPDATE market_ai_jobs SET status='blocked', last_error='NO_CREDIT',
               next_run_at=NOW()+interval '24 hours', updated_at=NOW() WHERE id=$1`,
            [job.id]
          );
          console.warn('[MarketAiCron] NO_CREDIT — блок 24ч');
          break;
        }
        console.warn('[MarketAiCron] job', job.id, e.message);
        await jobs.markFailed(db, job.id, e.message);
        stats.failed++;
      }
    }
  } finally {
    await unlock();
    running = false;
  }
  if (stats.claimed) {
    console.log(
      `[MarketAiCron] claimed=${stats.claimed} done=${stats.done} failed=${stats.failed} photos=${stats.photos} cost≈${stats.cost} blocked=${stats.blocked}`
    );
  }
  return stats;
}

function init() {
  if (timer) return;
  timer = setInterval(() => {
    tick(15).catch((e) => console.warn('[MarketAiCron]', e.message));
  }, INTERVAL_MS);
  // первый проход через минуту после старта
  setTimeout(() => {
    tick(10).catch((e) => console.warn('[MarketAiCron]', e.message));
  }, 60 * 1000);
  console.log('[MarketAiCron] started, interval', INTERVAL_MS / 1000, 's');
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  init,
  stop,
  tick,
  processJob,
  generateDescription,
};
