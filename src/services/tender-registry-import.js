/**
 * Import tender registry from Excel (with period + CRM dedup/merge)
 */
const {
  DEFAULT_XLSX,
  readWorkbookRows,
  dedupeExcelRowsByUrl,
  auditRowsAgainstCrm,
  matchRowToCrm,
  buildCrmIndex,
  resolveImportMatch,
  normUrl
} = require('./tender-registry-import-utils');
const { syncTenderStatus } = require('./tender-registry-helpers');

async function loadUsers(db) {
  const r = await db.query(`SELECT id, name FROM users WHERE is_active IS DISTINCT FROM false`);
  return new Map(r.rows.map(u => [String(u.name).trim().toLowerCase(), u.id]));
}

async function loadCrmTenders(db) {
  const r = await db.query(`
    SELECT id, customer_name, customer_inn, tender_title, purchase_url,
           registry_status, tender_price, docs_deadline, period, deleted_at, tender_status
    FROM tenders WHERE deleted_at IS NULL
  `);
  return r.rows;
}

async function loadWorksSet(db) {
  const r = await db.query(`
    SELECT DISTINCT tender_id FROM works WHERE deleted_at IS NULL AND tender_id IS NOT NULL
  `);
  return new Set(r.rows.map(x => x.tender_id));
}

function applyMergeSet(patch) {
  const sets = [];
  const params = [];
  let i = 1;
  for (const [k, v] of Object.entries(patch)) {
    sets.push(`${k} = $${i++}`);
    params.push(v);
  }
  if (patch.registry_status) {
    sets.push(`tender_status = $${i++}`);
    params.push(syncTenderStatus(patch.registry_status));
  }
  return { sets, params };
}

async function spawnImport(db, opts = {}) {
  const filePath = opts.file_path || DEFAULT_XLSX;
  const dryRun = opts.dry_run !== false;
  const strategy = opts.conflict_strategy || 'excel_registry';

  let workbook;
  try {
    workbook = await readWorkbookRows(filePath);
  } catch (e) {
    return { ok: false, error: e.message, dry_run: dryRun };
  }

  const rawRows = workbook.rows;
  const rows = dedupeExcelRowsByUrl(rawRows);
  const byPeriod = {};
  for (const row of rows) {
    const p = row.period || 'unknown';
    byPeriod[p] = (byPeriod[p] || 0) + 1;
  }

  const crmRows = await loadCrmTenders(db);
  const worksSet = await loadWorksSet(db);
  const audit = auditRowsAgainstCrm(rows, crmRows);
  const userByName = await loadUsers(db);
  let index = buildCrmIndex(crmRows);

  const resolvedPreview = [];
  for (const row of rows) {
    const m = matchRowToCrm(row, index);
    const resolved = resolveImportMatch(m, {
      hasWork: m.tender_id ? worksSet.has(m.tender_id) : false,
      strategy
    });
    if (resolved.resolved_from && resolvedPreview.length < 50) {
      resolvedPreview.push({
        tender_id: resolved.tender_id,
        from: m.action,
        to: resolved.action,
        conflict: resolved.conflict,
        has_work: m.tender_id ? worksSet.has(m.tender_id) : false,
        title: row.tender_title?.slice(0, 50)
      });
    }
  }

  if (dryRun) {
    let wouldCreate = 0;
    let wouldMerge = 0;
    let wouldSkip = 0;
    let wouldConflict = 0;
    for (const row of rows) {
      const m = matchRowToCrm(row, index);
      const r = resolveImportMatch(m, {
        hasWork: m.tender_id ? worksSet.has(m.tender_id) : false,
        strategy
      });
      if (r.action === 'new') wouldCreate++;
      else if (r.action === 'duplicate_merge') wouldMerge++;
      else if (r.action === 'duplicate_skip') wouldSkip++;
      else if (r.action === 'conflict') wouldConflict++;
    }

    return {
      ok: true,
      dry_run: true,
      file: filePath,
      rows_raw: rawRows.length,
      rows_deduped: rows.length,
      by_period: byPeriod,
      audit_summary: audit.summary,
      would_create: wouldCreate,
      would_merge: wouldMerge,
      would_skip: wouldSkip,
      would_conflict: wouldConflict,
      resolved_conflicts: resolvedPreview,
      audit_by_period: audit.byPeriod,
      sample: audit.items.slice(0, 100)
    };
  }

  let created = 0;
  let merged = 0;
  let skipped = 0;
  let conflicts = 0;
  let resolved = 0;
  const handledUrls = new Set();

  for (const row of rows) {
    const url = normUrl(row.purchase_url);
    if (url && handledUrls.has(url)) {
      skipped++;
      continue;
    }

    let m = matchRowToCrm(row, index);
    m = resolveImportMatch(m, {
      hasWork: m.tender_id ? worksSet.has(m.tender_id) : false,
      strategy
    });

    if (m.resolved_from === 'conflict') resolved++;

    if (m.action === 'duplicate_skip') {
      if (url) handledUrls.add(url);
      skipped++;
      continue;
    }

    if (m.action === 'conflict') {
      conflicts++;
      continue;
    }

    if (m.action === 'duplicate_merge') {
      const { sets, params } = applyMergeSet(m.patch);
      if (sets.length) {
        params.push(m.tender_id);
        await db.query(
          `UPDATE tenders SET ${sets.join(', ')}, updated_at = NOW(), source_kind = COALESCE(source_kind, 'to_manual') WHERE id = $${params.length}`,
          params
        );
        merged++;
        if (url) handledUrls.add(url);
        const crm = crmRows.find(t => t.id === m.tender_id);
        if (crm) Object.assign(crm, m.patch);
      } else {
        skipped++;
      }
      continue;
    }

    const created_by = row.created_by_name ? userByName.get(row.created_by_name) : null;
    const registry_status = row.registry_status || 'рассмотрение';
    const period = row.period || new Date().toISOString().slice(0, 7);
    const tender_status = syncTenderStatus(registry_status);

    const ins = await db.query(`
      INSERT INTO tenders (
        customer_name, customer_inn, tender_title, tender_price, docs_deadline, purchase_url,
        registry_status, tender_status, reject_reason, comment_to, source_kind, created_by,
        created_by_user_id, period, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'to_manual',$11,$11,$12,NOW())
      RETURNING id, purchase_url, customer_inn, customer_name, tender_title, registry_status, tender_price, period
    `, [
      row.customer_name,
      row.customer_inn,
      row.tender_title,
      row.tender_price || null,
      row.docs_deadline || null,
      row.purchase_url || null,
      registry_status,
      tender_status,
      row.reject_reason,
      row.comment_to,
      created_by,
      period
    ]);

    const t = ins.rows[0];
    crmRows.push({ ...t, deleted_at: null });
    index = buildCrmIndex(crmRows);
    if (url) handledUrls.add(url);
    created++;
  }

  return {
    ok: true,
    dry_run: false,
    file: filePath,
    rows_raw: rawRows.length,
    rows_deduped: rows.length,
    created,
    merged,
    skipped,
    conflicts,
    resolved_conflicts: resolved,
    by_period: byPeriod,
    audit_summary: audit.summary
  };
}

module.exports = { spawnImport };
