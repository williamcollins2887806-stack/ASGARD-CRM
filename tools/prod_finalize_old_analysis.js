#!/usr/bin/env node
/**
 * Finalize stale analysis-queue tenders (period != 2026-07) as duty PM.
 * Run on prod: node tools/prod_finalize_old_analysis.js [--dry-run]
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DRY = process.argv.includes('--dry-run');
const DUTY_USER_ID = 3474; // current duty PM fallback
const KEEP_PERIOD = '2026-07';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://asgard:123456789@localhost/asgard_crm'
});

const exclude = `
  AND t.source_pre_tender_id IS NULL
  AND LOWER(COALESCE(t.tender_title, '')) NOT LIKE 'st-%'
  AND LOWER(COALESCE(t.customer_name, '')) NOT LIKE 'st-%'
  AND LOWER(COALESCE(cb.name, '')) NOT LIKE 'test %'
`;

function syncTenderStatus(registryStatus) {
  const map = {
    рассмотрение: 'Новый',
    готовим: 'На анализе',
    подались: 'КП отправлено',
    выиграли: 'Выиграли',
    проиграли: 'Проиграли',
    отмена: 'Не подходит'
  };
  return map[registryStatus] || 'Новый';
}

async function ensureReview(client, tenderId, userId) {
  let r = await client.query('SELECT * FROM tender_rp_reviews WHERE tender_id = $1', [tenderId]);
  if (r.rows[0]) return r.rows[0];
  r = await client.query(
    `INSERT INTO tender_rp_reviews (tender_id, started_by_user_id, updated_at)
     VALUES ($1, $2, NOW()) RETURNING *`,
    [tenderId, userId]
  );
  return r.rows[0];
}

async function attachStubEstimate(client, tenderId, userId, reviewId) {
  const uploadRoot = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
  const dir = path.join(uploadRoot, 'rp_estimates', String(tenderId));
  fs.mkdirSync(dir, { recursive: true });
  const safeName = `${Date.now()}_stub_smeta.csv`;
  const filePath = path.join(dir, safeName);
  const content = 'Позиция;Кол-во;Ед;Цена\nАрхивная смета-заглушка;1;шт;0\n';
  fs.writeFileSync(filePath, content, 'utf8');
  const downloadUrl = `/uploads/rp_estimates/${tenderId}/${safeName}`;
  const doc = await client.query(
    `INSERT INTO documents (filename, original_name, mime_type, size, type, tender_id, uploaded_by, download_url, created_at)
     VALUES ($1, $2, $3, $4, 'rp_estimate', $5, $6, $7, NOW()) RETURNING id`,
    [safeName, 'Смета_архив_заглушка.csv', 'text/csv', Buffer.byteLength(content), tenderId, userId, downloadUrl]
  );
  const fileId = doc.rows[0].id;
  await client.query(
    'UPDATE tender_rp_reviews SET estimate_file_id = $1, updated_at = NOW() WHERE id = $2',
    [fileId, reviewId]
  );
  return fileId;
}

async function finalizeTender(client, row, userId) {
  const tenderId = row.id;
  const review = await ensureReview(client, tenderId, userId);
  if (review.is_final) {
    return { tenderId, skipped: true, reason: 'already_final' };
  }

  const reportJson = {
    mode: 'analysis',
    feasibility: 'yes',
    competition: 'medium',
    summary: 'Архивный тендер реестра: быстрый анализ дежурного РП (закрыто при чистке очереди).',
    recommendation: 'Подаём — переведено в «Готовим» для дальнейшего просчёта.',
    risks: 'Историческая запись, сроки подачи могли истечь.',
    price_range_min: row.tender_price ? Math.round(Number(row.tender_price) * 0.7) : null,
    price_range_max: row.tender_price ? Math.round(Number(row.tender_price) * 0.9) : null,
    scope: '', risks_notes: '', points: [], questions_for_customer: []
  };

  const estimateFileId = await attachStubEstimate(client, tenderId, userId, review.id);

  await client.query(
    `UPDATE tender_rp_reviews SET
      decision = 'submit',
      report_kind = 'work',
      report_json = $1,
      missing_info_flags = $2,
      work_price = NULL,
      estimate_file_id = $3,
      is_final = true,
      started_by_user_id = COALESCE(started_by_user_id, $4),
      finalized_by_user_id = $4,
      calculator_user_id = $4,
      updated_at = NOW()
    WHERE tender_id = $5`,
    [JSON.stringify(reportJson), [], estimateFileId, userId, tenderId]
  );

  await client.query(
    `INSERT INTO tender_rp_review_log (review_id, tender_id, actor_user_id, action, payload_json)
     VALUES ($1, $2, $3, 'finalize', $4)`,
    [review.id, tenderId, userId, JSON.stringify({ decision: 'submit', report_kind: 'work', bulk: 'archive_cleanup' })]
  );

  await client.query(
    `UPDATE tenders SET registry_status = 'готовим', tender_status = $1, calculator_user_id = $2, updated_at = NOW()
     WHERE id = $3`,
    [syncTenderStatus('готовим'), userId, tenderId]
  );

  return { tenderId, period: row.period, status: 'готовим', estimateFileId };
}

async function main() {
  const client = await pool.connect();
  try {
    const duty = await client.query(`
      SELECT pm_user_id FROM pm_duty_roster
      WHERE period_start <= CURRENT_DATE AND period_end >= CURRENT_DATE
      ORDER BY id DESC LIMIT 1
    `);
    const userId = duty.rows[0]?.pm_user_id || DUTY_USER_ID;

    const q = await client.query(`
      SELECT t.id, t.period, t.tender_price, t.customer_name, t.tender_title
      FROM tenders t
      LEFT JOIN tender_rp_reviews rev ON rev.tender_id = t.id
      LEFT JOIN users cb ON cb.id = t.created_by
      WHERE t.deleted_at IS NULL
        AND t.registry_status = 'рассмотрение'
        AND (rev.is_final IS NULL OR rev.is_final = false)
        AND COALESCE(t.period, '') <> $1
        ${exclude}
      ORDER BY t.id
    `, [KEEP_PERIOD]);

    console.log(JSON.stringify({
      dry_run: DRY,
      duty_user_id: userId,
      to_finalize: q.rows.length,
      ids: q.rows.map((r) => r.id)
    }, null, 2));

    if (DRY) return;

    await client.query('BEGIN');
    const results = [];
    for (const row of q.rows) {
      results.push(await finalizeTender(client, row, userId));
    }
    await client.query('COMMIT');

    const left = await client.query(`
      SELECT COUNT(*)::int AS c FROM tenders t
      LEFT JOIN tender_rp_reviews rev ON rev.tender_id = t.id
      LEFT JOIN users cb ON cb.id = t.created_by
      WHERE t.deleted_at IS NULL AND t.registry_status = 'рассмотрение'
        AND (rev.is_final IS NULL OR rev.is_final = false) ${exclude}
    `);
    console.log(JSON.stringify({ finalized: results, analysis_left: left.rows[0].c }, null, 2));
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
