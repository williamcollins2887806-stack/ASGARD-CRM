/**
 * TenderGuru sync — enrich our tenders + import candidates
 */
const { searchTenders, enrichTenderFromApi } = require('./tenderguru-client');
const { loadTenderGuruSettings, recordSyncResult } = require('./tenderguru-settings');
const { writeTenderGuruEnrichAudit } = require('./tender-registry-helpers');
const { enrichLostTenders } = require('./tender-outcome-enrich');

let candidateColumnsCache = null;

async function loadCandidateInsertShape(db) {
  if (candidateColumnsCache) return candidateColumnsCache;
  const r = await db.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tenderguru_candidates'
  `);
  candidateColumnsCache = new Set(r.rows.map((row) => row.column_name));
  return candidateColumnsCache;
}

async function acquireLock(db, lockKey, ttlMinutes = 30) {
  const r = await db.query(`
    INSERT INTO cron_locks (lock_key, acquired_at, expires_at)
    VALUES ($1, NOW(), NOW() + ($2 || ' minutes')::interval)
    ON CONFLICT (lock_key) DO UPDATE SET
      acquired_at = NOW(),
      expires_at = NOW() + ($2 || ' minutes')::interval
    WHERE cron_locks.expires_at < NOW()
    RETURNING lock_key
  `, [lockKey, String(ttlMinutes)]);
  return r.rows.length > 0;
}

async function releaseLock(db, lockKey) {
  await db.query('DELETE FROM cron_locks WHERE lock_key = $1', [lockKey]).catch(() => {});
}

async function runTenderGuruSync(db, log = console, opts = {}) {
  const settings = await loadTenderGuruSettings(db);
  const apiKey = process.env.TENDERGURU_API_KEY;

  if (!settings.enabled && !opts.force) {
    return { skipped: true, reason: 'disabled' };
  }
  if (!apiKey) {
    return { skipped: true, reason: 'no_api_key' };
  }

  const filterOpts = {
    apiKey,
    kwords: settings.kwords,
    kwords_minus: settings.kwords_minus,
    f: settings.f,
    actual: settings.actual,
    day: settings.day,
    price1: settings.price1,
    price2: settings.price2,
    page_limit: settings.page_limit
  };

  const enrichMonths = settings.enrich_max_age_months || 3;
  let enriched = 0;

  const tenders = await db.query(`
    SELECT id, purchase_url, docs_deadline, registry_status, tender_price, created_at
    FROM tenders
    WHERE deleted_at IS NULL
      AND purchase_url IS NOT NULL
      AND created_at >= NOW() - ($1 || ' months')::interval
    ORDER BY updated_at DESC
    LIMIT 300
  `, [String(enrichMonths)]);

  for (const t of tenders.rows) {
    try {
      const r = await enrichTenderFromApi(t, filterOpts);
      if (!r.enriched) continue;
      const updates = [];
      const params = [];
      const auditChanges = [];
      let i = 1;
      if (r.docs_deadline && !t.docs_deadline) {
        updates.push(`docs_deadline = $${i++}`);
        params.push(r.docs_deadline);
        auditChanges.push({ field: 'docs_deadline', before: t.docs_deadline, after: r.docs_deadline });
      }
      if (r.tender_price && !t.tender_price) {
        updates.push(`tender_price = $${i++}`);
        params.push(r.tender_price);
        auditChanges.push({ field: 'tender_price', before: t.tender_price, after: r.tender_price });
      }
      if (updates.length) {
        params.push(t.id);
        await db.query(`UPDATE tenders SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${i}`, params);
        await writeTenderGuruEnrichAudit(db, { tenderId: t.id, changes: auditChanges });
        enriched++;
        log.info('[TenderGuruCron] enriched tender', { id: t.id, changes: auditChanges });
      }
    } catch (e) {
      log.warn('[TenderGuruCron] enrich', t.id, e.message);
    }
  }

  const { items, total, error } = await searchTenders(filterOpts);
  if (error) {
    const result = { enriched, candidates: 0, error };
    await recordSyncResult(db, result);
    return result;
  }

  let candidates = 0;
  for (const it of items) {
    const title = it.title;
    const url = it.purchase_url;
    const external_id = it.id;
    const dup = await db.query(`
      SELECT 1 FROM tenders WHERE deleted_at IS NULL AND (
        ($1::text IS NOT NULL AND purchase_url = $1)
        OR tender_title ILIKE $2
        OR purchase_url ILIKE $3
      ) LIMIT 1
    `, [url, `%${title.slice(0, 40)}%`, `%/tender/${external_id}%`]);
    if (dup.rows.length) continue;

    const exists = await db.query(
      'SELECT id FROM tenderguru_candidates WHERE external_id = $1 LIMIT 1',
      [external_id]
    );
    if (exists.rows.length) continue;

    const rawPayload = { ...(it.raw || it) };
    if (it.region && !rawPayload.Region) rawPayload.Region = it.region;
    const customerInn = it.customer_inn
      || (it.raw && (it.raw.CustomerINN ?? it.raw.customer_inn ?? it.raw.zorg_inn))
      || null;
    const innNorm = customerInn != null ? String(customerInn).replace(/\D/g, '') || null : null;

    // Названия чистим от эмодзи: внешние площадки присылают «🌐 АО ЦБК»,
    // и это доезжало до карточек, писем и ТКП (правило — только русский текст).
    const { cleanName } = require('../lib/clean-name');
    const cleanCustomer = cleanName(it.customer_name) || it.customer_name;
    const cleanTitle = cleanName(title) || title;

    const cols = await loadCandidateInsertShape(db);
    if (cols.has('region') && it.region) {
      await db.query(`
        INSERT INTO tenderguru_candidates (external_id, title, customer_name, customer_inn, nmc, deadline, purchase_url, region, raw_json)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `, [
        external_id, cleanTitle, cleanCustomer, innNorm,
        it.nmc, it.deadline, url, it.region, JSON.stringify(rawPayload)
      ]);
    } else {
      await db.query(`
        INSERT INTO tenderguru_candidates (external_id, title, customer_name, customer_inn, nmc, deadline, purchase_url, raw_json)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      `, [
        external_id, cleanTitle, cleanCustomer, innNorm,
        it.nmc, it.deadline, url, JSON.stringify(rawPayload)
      ]);
    }
    candidates++;
  }

  let outcome = { skipped: true, reason: 'after_candidates' };
  try {
    outcome = await enrichLostTenders(db, log, {
      apiKey,
      limit: settings.outcome_enrich_limit || 40
    });
  } catch (e) {
    log.warn('[TenderGuruCron] outcome enrich', e.message);
    outcome = { error: e.message };
  }

  const result = { enriched, candidates, total, outcome, enabled: settings.enabled };
  await recordSyncResult(db, result);
  return result;
}

function startTenderGuruCron(db, log) {
  const cron = require('node-cron');
  cron.schedule('0 3 * * *', async () => {
    const lockKey = 'tenderguru_sync';
    try {
      const got = await acquireLock(db, lockKey, 60);
      if (!got) return;
      const result = await runTenderGuruSync(db, log);
      log.info('[TenderGuruCron] done', result);
    } catch (e) {
      log.warn('[TenderGuruCron] failed', e.message);
    } finally {
      await releaseLock(db, lockKey);
    }
  });
}

module.exports = { runTenderGuruSync, startTenderGuruCron, acquireLock, releaseLock };
