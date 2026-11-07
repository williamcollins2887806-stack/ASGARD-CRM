/**
 * Обогащение проигранных тендеров данными о победителе из TenderGuru (контракты).
 */
const {
  fetchContracts,
  fetchContractsAll,
  fetchContractById,
  extractPurchaseNumber
} = require('./tenderguru-client');
const { writeTenderGuruEnrichAudit } = require('./tender-registry-helpers');

const STOP_WORDS = new Set([
  'и', 'в', 'на', 'по', 'для', 'из', 'к', 'с', 'о', 'об', 'от', 'до', 'при', 'без', 'не',
  'the', 'a', 'an', 'of', 'for', 'на', 'за', 'или', 'это', 'все', 'г', 'г.', 'ул', 'стр'
]);

let tenderColumnCache = null;

async function loadTenderColumns(db) {
  if (tenderColumnCache) return tenderColumnCache;
  const r = await db.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tenders'
  `);
  tenderColumnCache = new Set(r.rows.map((row) => row.column_name));
  return tenderColumnCache;
}

function tenderHasColumn(cols, name) {
  return cols.has(name);
}

function tokenizeTitle(title) {
  if (!title) return [];
  return String(title)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w))
    .slice(0, 8);
}

function buildKwordsFromTitle(title) {
  const tokens = tokenizeTitle(title);
  if (!tokens.length) return null;
  if (tokens.length <= 3) return tokens.join(' ');
  return `"${tokens.slice(0, 4).join(' ')}"`;
}

function addDaysIso(dateLike, days) {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function anchorDate(tender) {
  return tender.lost_at || tender.docs_deadline || tender.submitted_at || tender.created_at;
}

function priceBand(nmc, pct = 0.3) {
  const base = Number(nmc);
  if (!Number.isFinite(base) || base <= 0) return { price1: null, price2: null };
  return {
    price1: Math.floor(base * (1 - pct)),
    price2: Math.ceil(base * (1 + pct))
  };
}

function scoreContractMatch(tender, contract) {
  const custInn = String(tender.customer_inn || '').replace(/\D/g, '');
  const cInn = String(contract.customer_inn || '').replace(/\D/g, '');
  if (custInn && cInn && custInn !== cInn) return -1;

  let score = 0;
  if (custInn && cInn && custInn === cInn) score += 35;

  const tendNum = extractPurchaseNumber(tender.purchase_url);
  const contractTend = contract.tender_num ? String(contract.tender_num).replace(/\D/g, '') : '';
  if (tendNum && contractTend && tendNum === contractTend) score += 55;

  const tokens = tokenizeTitle(tender.tender_title);
  const hay = `${contract.title || ''} ${contract.raw?.ContractName || ''}`.toLowerCase();
  let hits = 0;
  for (const t of tokens) {
    if (hay.includes(t)) hits++;
  }
  score += Math.min(25, hits * 8);

  const refNmc = Number(tender.tender_price) || Number(tender.submission_price) || contract.nmc;
  const contractPrice = contract.price;
  if (refNmc && contractPrice) {
    const ratio = contractPrice / refNmc;
    if (ratio >= 0.7 && ratio <= 1.3) score += 20;
    else if (ratio >= 0.5 && ratio <= 1.5) score += 8;
    else return -1;
  }

  const anchor = anchorDate(tender);
  const cDate = contract.sign_date || contract.date;
  if (anchor && cDate) {
    const diff = Math.abs(new Date(anchor) - new Date(cDate)) / 86400000;
    if (diff <= 90) score += 15;
    else if (diff <= 120) score += 5;
    else if (diff > 200) score -= 15;
  }

  return score;
}

async function findLostWithoutWinner(db, limit = 50) {
  const r = await db.query(`
    SELECT id, tender_title, customer_inn, customer_name, tender_price, submission_price,
           purchase_url, lost_at, docs_deadline, created_at, submitted_at,
           loss_winner_price, winner_name, loss_source, registry_status
    FROM tenders
    WHERE deleted_at IS NULL
      AND registry_status = 'проиграли'
      AND (
        loss_winner_price IS NULL
        OR winner_name IS NULL OR btrim(winner_name) = ''
      )
      AND COALESCE(loss_source, '') NOT IN ('tenderguru')
    ORDER BY lost_at DESC NULLS LAST, updated_at DESC
    LIMIT $1
  `, [Math.min(Math.max(limit, 1), 500)]);
  return r.rows;
}

async function searchContractsForTender(tender, apiKey) {
  const filters = { apiKey, page_limit: 100, max_pages: 5 };
  const tendNum = extractPurchaseNumber(tender.purchase_url);
  if (tendNum) {
    const byNum = await fetchContracts({ ...filters, tend_num: tendNum, page_limit: 20 });
    if (!byNum.error && byNum.items.length) return { items: byNum.items, via: 'tend_num' };
  }

  const kwords = buildKwordsFromTitle(tender.tender_title);
  const anchor = anchorDate(tender);
  const date_start = anchor ? addDaysIso(anchor, -90) : null;
  const date_end = anchor ? addDaysIso(anchor, 90) : null;
  const band = priceBand(tender.tender_price || tender.submission_price);

  const searchOpts = {
    ...filters,
    kwords: kwords || undefined,
    inn: tender.customer_inn ? String(tender.customer_inn).replace(/\D/g, '') : undefined,
    date_start,
    date_end,
    price1: band.price1,
    price2: band.price2
  };

  const listed = await fetchContractsAll(searchOpts, filters.max_pages);
  if (listed.error && !listed.items.length) return { items: [], error: listed.error, via: 'search' };
  return { items: listed.items, error: listed.error, via: 'search' };
}

function pickMatches(tender, items) {
  const scored = [];
  for (const c of items) {
    const s = scoreContractMatch(tender, c);
    if (s >= 40) scored.push({ contract: c, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function contractSnapshot(c) {
  return {
    id: c.id,
    title: c.title,
    supplier_name: c.supplier_name,
    supplier_inn: c.supplier_inn,
    price: c.price,
    customer_inn: c.customer_inn,
    tender_num: c.tender_num,
    date: c.date
  };
}

async function queueAmbiguous(db, tenderId, candidates) {
  const payload = JSON.stringify(
    candidates.map((x) => ({ ...contractSnapshot(x.contract), score: x.score }))
  );
  await db.query(`
    DELETE FROM tender_outcome_match_queue WHERE tender_id = $1 AND status = 'pending'
  `, [tenderId]);
  await db.query(`
    INSERT INTO tender_outcome_match_queue (tender_id, match_candidates, status)
    VALUES ($1, $2::jsonb, 'pending')
  `, [tenderId, payload]);
}

async function applyOutcome(db, tender, contract, { partial = false } = {}) {
  const cols = await loadTenderColumns(db);
  const lossSource = partial ? 'tenderguru_partial' : 'tenderguru';

  const sets = ['loss_source = $1', 'updated_at = NOW()'];
  const params = [lossSource];
  let i = 2;
  const auditChanges = [{ field: 'loss_source', before: tender.loss_source, after: lossSource }];

  const winnerPrice = contract.price;
  if (winnerPrice != null && tender.loss_winner_price == null) {
    sets.push(`loss_winner_price = $${i++}`);
    params.push(winnerPrice);
    auditChanges.push({ field: 'loss_winner_price', before: tender.loss_winner_price, after: winnerPrice });
  }
  if (winnerPrice != null && tenderHasColumn(cols, 'winner_price_no_vat')) {
    const curWinNoVat = tender.winner_price_no_vat;
    if (curWinNoVat == null) {
      sets.push(`winner_price_no_vat = $${i++}`);
      params.push(winnerPrice);
      auditChanges.push({ field: 'winner_price_no_vat', before: curWinNoVat, after: winnerPrice });
    }
  }

  const winnerName = contract.supplier_name;
  if (winnerName && (!tender.winner_name || !String(tender.winner_name).trim())) {
    sets.push(`winner_name = $${i++}`);
    params.push(winnerName);
    auditChanges.push({ field: 'winner_name', before: tender.winner_name, after: winnerName });
  }

  const winnerInnCol = tenderHasColumn(cols, 'winner_inn')
    ? 'winner_inn'
    : (tenderHasColumn(cols, 'loss_winner_inn') ? 'loss_winner_inn' : null);
  if (winnerInnCol && contract.supplier_inn) {
    sets.push(`${winnerInnCol} = $${i++}`);
    params.push(contract.supplier_inn);
    auditChanges.push({ field: winnerInnCol, before: null, after: contract.supplier_inn });
  }

  params.push(tender.id);
  await db.query(`UPDATE tenders SET ${sets.join(', ')} WHERE id = $${i}`, params);
  await writeTenderGuruEnrichAudit(db, { tenderId: tender.id, changes: auditChanges });

  return {
    applied: true,
    partial,
    winner_price: winnerPrice,
    winner_name: winnerName,
    winner_inn: contract.supplier_inn || null,
    contract_id: contract.id
  };
}

/**
 * @returns {Promise<object>} ok, matched, ambiguous, skipped, reason, ...
 */
async function enrichTenderOutcome(db, tenderId, opts = {}) {
  const apiKey = opts.apiKey || process.env.TENDERGURU_API_KEY;
  if (!apiKey) return { ok: false, skipped: true, reason: 'no_api_key' };

  const cur = await db.query(`
    SELECT id, tender_title, customer_inn, customer_name, tender_price, submission_price,
           purchase_url, lost_at, docs_deadline, created_at, submitted_at,
           loss_winner_price, winner_name, loss_source, registry_status
    FROM tenders WHERE id = $1 AND deleted_at IS NULL
  `, [tenderId]);
  const tender = cur.rows[0];
  if (!tender) return { ok: false, reason: 'not_found' };
  if (tender.registry_status !== 'проиграли') {
    return { ok: false, skipped: true, reason: 'not_lost' };
  }
  if (!opts.force && tender.loss_source === 'tenderguru') {
    return { ok: false, skipped: true, reason: 'already_enriched' };
  }

  const { items, error, via } = await searchContractsForTender(tender, apiKey);
  if (error && !items.length) {
    return { ok: false, matched: false, reason: 'api_error', error, via };
  }
  if (!items.length) {
    return { ok: true, matched: false, reason: 'no_contracts', via };
  }

  const ranked = pickMatches(tender, items);
  if (!ranked.length) {
    return { ok: true, matched: false, reason: 'no_confident_match', via, candidates: items.length };
  }

  const top = ranked[0];
  const strong = ranked.filter((x) => x.score >= 60);
  if (strong.length > 1 && top.score < 85) {
    await queueAmbiguous(db, tender.id, strong.slice(0, 5));
    return {
      ok: true,
      matched: false,
      ambiguous: true,
      reason: 'ambiguous',
      queue: strong.length,
      via
    };
  }

  if (top.score < 65) {
    if (ranked.length > 1) {
      await queueAmbiguous(db, tender.id, ranked.slice(0, 5));
      return { ok: true, matched: false, ambiguous: true, reason: 'low_confidence_multiple', via };
    }
    return { ok: true, matched: false, reason: 'low_confidence', score: top.score, via };
  }

  let contract = top.contract;
  if (!contract.supplier_name || contract.price == null) {
    const detail = await fetchContractById(contract.id, { apiKey });
    if (detail.item) contract = detail.item;
  }

  const partial = !contract.supplier_name || contract.price == null;
  const applied = await applyOutcome(db, tender, contract, { partial });
  return {
    ok: true,
    matched: true,
    partial,
    score: top.score,
    via,
    ...applied
  };
}

async function enrichLostTenders(db, log = console, opts = {}) {
  const apiKey = opts.apiKey || process.env.TENDERGURU_API_KEY;
  if (!apiKey) return { skipped: true, reason: 'no_api_key' };

  const limit = opts.limit || 40;
  const rows = await findLostWithoutWinner(db, limit);
  let matched = 0;
  let ambiguous = 0;
  let failed = 0;
  let noMatch = 0;

  for (const t of rows) {
    try {
      const r = await enrichTenderOutcome(db, t.id, { apiKey, force: opts.force });
      if (r.matched) matched++;
      else if (r.ambiguous) ambiguous++;
      else if (r.skipped) { /* skip */ }
      else noMatch++;
    } catch (e) {
      failed++;
      log.warn('[TenderOutcomeEnrich]', t.id, e.message);
    }
  }

  const summary = { processed: rows.length, matched, ambiguous, noMatch, failed };
  log.info('[TenderOutcomeEnrich] done', summary);
  return summary;
}

async function resolveOutcomeMatchQueue(db, queueId, userId, { accept = true, candidateId = null } = {}) {
  const q = await db.query(
    `SELECT * FROM tender_outcome_match_queue WHERE id = $1`,
    [queueId]
  );
  const row = q.rows[0];
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.status !== 'pending') return { ok: false, reason: 'not_pending', status: row.status };

  if (!accept) {
    await db.query(`
      UPDATE tender_outcome_match_queue
      SET status = 'dismissed', resolved_at = NOW(), resolved_by_user_id = $2, updated_at = NOW()
      WHERE id = $1
    `, [queueId, userId]);
    return { ok: true, dismissed: true };
  }

  let candidates = row.match_candidates;
  if (typeof candidates === 'string') {
    try { candidates = JSON.parse(candidates); } catch (_) { candidates = []; }
  }
  if (!Array.isArray(candidates) || !candidates.length) {
    return { ok: false, reason: 'no_candidates' };
  }
  const pick = candidates.find((c) => String(c.id) === String(candidateId))
    || (candidateId == null ? candidates[0] : null);
  if (!pick) return { ok: false, reason: 'candidate_not_found' };

  const tenderRes = await db.query(
    `SELECT * FROM tenders WHERE id = $1 AND deleted_at IS NULL`,
    [row.tender_id]
  );
  const tender = tenderRes.rows[0];
  if (!tender) return { ok: false, reason: 'tender_not_found' };

  const contract = {
    id: pick.id,
    supplier_name: pick.supplier_name,
    supplier_inn: pick.supplier_inn,
    price: pick.price,
    title: pick.title,
    customer_inn: pick.customer_inn,
    tender_num: pick.tender_num,
    date: pick.date
  };
  const partial = !contract.supplier_name || contract.price == null;
  const applied = await applyOutcome(db, tender, contract, { partial });

  await db.query(`
    UPDATE tender_outcome_match_queue
    SET status = 'confirmed', resolved_at = NOW(), resolved_by_user_id = $2, updated_at = NOW()
    WHERE id = $1
  `, [queueId, userId]);

  return { ok: true, matched: true, tender_id: row.tender_id, ...applied };
}

module.exports = {
  findLostWithoutWinner,
  enrichTenderOutcome,
  enrichLostTenders,
  buildKwordsFromTitle,
  scoreContractMatch,
  applyOutcome,
  resolveOutcomeMatchQueue
};
