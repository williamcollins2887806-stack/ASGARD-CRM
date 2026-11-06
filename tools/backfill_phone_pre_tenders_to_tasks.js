#!/usr/bin/env node
'use strict';

/**
 * Перенос «пустых» телефонных заявок маркетплейса в «Мои задачи».
 *
 * Кандидаты: source_type=phone, status=new, без created_tender_id, без документов.
 * Спорные (есть docs / не new / уже tender) — только в отчёт.
 *
 * Usage:
 *   node tools/backfill_phone_pre_tenders_to_tasks.js --dry-run
 *   node tools/backfill_phone_pre_tenders_to_tasks.js --apply
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const dryRun = process.argv.includes('--dry-run') || !process.argv.includes('--apply');

async function main() {
  const db = require('../src/services/db');
  const report = { migrated: [], skipped: [], errors: [] };

  const { rows: candidates } = await db.query(
    `SELECT pt.id, pt.customer_name, pt.contact_phone, pt.work_title, pt.work_description,
            pt.ai_summary, pt.assigned_to, pt.created_by, pt.status, pt.has_documents,
            pt.created_tender_id, pt.manual_documents,
            ch.id AS call_id
       FROM pre_tender_requests pt
       LEFT JOIN call_history ch ON ch.pre_tender_id = pt.id
      WHERE pt.source_type = 'phone'
        AND pt.created_tender_id IS NULL
      ORDER BY pt.id`
  );

  for (const row of candidates) {
    const docs = Array.isArray(row.manual_documents) ? row.manual_documents : [];
    const hasDocs = row.has_documents === true || docs.length > 0;
    const isCleanNew = row.status === 'new' && !hasDocs;

    if (!isCleanNew) {
      report.skipped.push({
        id: row.id,
        reason: hasDocs ? 'has_documents' : `status=${row.status}`,
        call_id: row.call_id
      });
      continue;
    }

    const assignee = row.assigned_to || row.created_by;
    if (!assignee) {
      report.skipped.push({ id: row.id, reason: 'no_assignee', call_id: row.call_id });
      continue;
    }

    const title = String(row.work_title || row.customer_name || 'Поручение из звонка').slice(0, 200);
    const description = [
      row.ai_summary || row.work_description || null,
      row.contact_phone ? 'Телефон: ' + row.contact_phone : null,
      row.customer_name ? 'Клиент: ' + row.customer_name : null,
      row.call_id ? 'Звонок #' + row.call_id : null,
      'Перенесено из заявки маркетплейса #' + row.id
    ].filter(Boolean).join('\n');

    if (dryRun) {
      report.migrated.push({ id: row.id, call_id: row.call_id, assignee, dry_run: true, title });
      continue;
    }

    try {
      const taskId = await db.transaction(async (client) => {
        const task = await client.query(
          `INSERT INTO tasks (
             title, description, assignee_id, creator_id, deadline, priority, status, tags, task_kind, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, NOW() + INTERVAL '3 days', 'normal', 'new', $5, 'directive', NOW(), NOW())
           RETURNING id`,
          [title, description, assignee, assignee, JSON.stringify(['звонок', 'перенос_из_маркетплейса'])]
        );
        const tid = task.rows[0].id;
        if (row.call_id) {
          await client.query(
            'UPDATE call_history SET task_id = COALESCE(task_id, $1), updated_at = NOW() WHERE id = $2',
            [tid, row.call_id]
          );
        }
        await client.query(
          `UPDATE pre_tender_requests
              SET status = 'rejected',
                  decision_comment = COALESCE(decision_comment, '') ||
                    CASE WHEN COALESCE(decision_comment,'') = '' THEN '' ELSE E'\\n' END ||
                    'перенесено в задачи из звонка (task #' || $2 || ')',
                  updated_at = NOW()
            WHERE id = $1`,
          [row.id, tid]
        );
        return tid;
      });
      report.migrated.push({ id: row.id, task_id: taskId, call_id: row.call_id, assignee });
    } catch (err) {
      report.errors.push({ id: row.id, error: err.message });
    }
  }

  console.log(JSON.stringify({ dryRun, ...report, migrated_count: report.migrated.length, skipped_count: report.skipped.length }, null, 2));
  process.exit(report.errors.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
