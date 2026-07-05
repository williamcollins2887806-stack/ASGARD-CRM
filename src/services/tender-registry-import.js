/**
 * Import tender registry from Excel (with period + CRM dedup/merge)
 */
const {
  DEFAULT_XLSX,
  readWorkbookRows,
  auditRowsAgainstCrm,
  matchRowToCrm,
  buildCrmIndex
} = require('./tender-registry-import-utils');
const { syncTenderStatus } = require('./tender-registry-helpers');

async function loadUsers(db) {
  const r = await db.query(`SELECT id, name FROM users WHERE is_active IS DISTINCT FROM false`);
  return new Map(r.rows.map(u => [String(u.name).trim().toLowerCase(), u.id]));
}

async function loadCrmTenders(db) {
  const r = await db.query(`
    SELECT id, customer_name, customer_inn, tender_title, purchase_url,
           registry_status, tender_price, docs_deadline, period, deleted_at
    FROM tenders WHERE deleted_at IS NULL
  `);
  return r.rows;
}

function applyMergeSet(row, patch) {
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

  let workbook;
  try {
    workbook = await readWorkbookRows(filePath);
  } catch (e) {
    return { ok: false, error: e.message, dry_run: dryRun };
  }

  const { rows, byPeriod } = workbook;
  const crmRows = await loadCrmTenders(db);
  const audit = auditRowsAgainstCrm(rows, crmRows);
  const userByName = await loadUsers(db);
  const index = buildCrmIndex(crmRows);

  if (dryRun) {
    return {
      ok: true,
      dry_run: true,
      file: filePath,
      rows: rows.length,
      by_period: byPeriod,
      audit_summary: audit.summary,
      audit_by_period: audit.byPeriod,
      sample: audit.items.slice(0, 100)
    };
  }

  let created = 0;
  let merged = 0;
  let skipped = 0;
  let conflicts = 0;

  for (const row of rows) {
    const m = matchRowToCrm(row, index);

    if (m.action === 'duplicate_skip') {
      skipped++;
      continue;
    }

    if (m.action === 'conflict') {
      conflicts++;
      continue;
    }

    if (m.action === 'duplicate_merge') {
      const { sets, params } = applyMergeSet(row, m.patch);
      if (sets.length) {
        params.push(m.tender_id);
        await db.query(
          `UPDATE tenders SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`,
          params
        );
        merged++;
      } else {
        skipped++;
      }
      continue;
    }

    const created_by = row.created_by_name ? userByName.get(row.created_by_name) : null;
    const registry_status = row.registry_status || 'рассмотрение';
    const period = row.period || new Date().toISOString().slice(0, 7);
    const tender_status = syncTenderStatus(registry_status);

    await db.query(`
      INSERT INTO tenders (
        customer_name, customer_inn, tender_title, tender_price, docs_deadline, purchase_url,
        registry_status, tender_status, reject_reason, comment_to, source_kind, created_by,
        created_by_user_id, period, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'to_manual',$11,$11,$12,NOW())
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
    created++;
  }

  return {
    ok: true,
    dry_run: false,
    file: filePath,
    rows: rows.length,
    created,
    merged,
    skipped,
    conflicts,
    by_period: byPeriod,
    audit_summary: audit.summary
  };
}

module.exports = { spawnImport };
