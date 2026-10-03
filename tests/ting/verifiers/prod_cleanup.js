#!/usr/bin/env node
/**
 * Dry-run / apply cleanup of Ting test rooms on a PG database.
 *
 * THING_CLEANUP_APPLY=1 — actually DELETE
 * Uses env DB_* / PG* (same as app). Prefer pointing at prod only when intentional.
 *
 * Markers: smoke, Скрин Тинга, Emu , Sched , Pin , LK probe, visual , emulator
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../../.env') });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const APPLY = process.env.THING_CLEANUP_APPLY === '1';
const reportPath = path.join(__dirname, '../../reports/THING-PROD-CLEANUP.md');

const TITLE_SQL = `
  title ILIKE '%smoke%'
  OR title ILIKE '%Скрин Тинга%'
  OR title ILIKE 'Emu %'
  OR title ILIKE 'Sched %'
  OR title ILIKE 'Pin %'
  OR title ILIKE 'LK probe%'
  OR title ILIKE '%visual %'
  OR title ILIKE '%emulator%'
  OR title ILIKE 'THING-%'
  OR title ILIKE 'Тинг smoke%'
`;

async function main() {
  const client = new Client({
    host: process.env.DB_HOST || process.env.PGHOST,
    port: parseInt(process.env.DB_PORT || process.env.PGPORT || '5432', 10),
    user: process.env.DB_USER || process.env.PGUSER,
    password: process.env.DB_PASSWORD || process.env.PGPASSWORD,
    database: process.env.DB_NAME || process.env.PGDATABASE
  });
  await client.connect();

  const { rows } = await client.query(
    `SELECT id, slug, title, status, host_user_id, meeting_id, created_at
     FROM thing_rooms
     WHERE ${TITLE_SQL}
     ORDER BY id DESC
     LIMIT 500`
  );

  console.log('candidates', rows.length);
  rows.slice(0, 30).forEach((r) => console.log(r.id, r.slug, r.title, r.status));

  let deleted = 0;
  let meetingsCleared = 0;
  if (APPLY && rows.length) {
    const ids = rows.map((r) => r.id);
    const meetingIds = rows.map((r) => r.meeting_id).filter(Boolean);
    await client.query('BEGIN');
    try {
      if (meetingIds.length) {
        await client.query(
          `UPDATE meetings SET thing_room_id = NULL, updated_at = NOW()
           WHERE thing_room_id = ANY($1::int[])`,
          [ids]
        );
        // delete only meetings whose title also looks like test
        const mdel = await client.query(
          `DELETE FROM meetings WHERE id = ANY($1::int[])
           AND (title ILIKE '%smoke%' OR title ILIKE 'Emu %' OR title ILIKE 'Sched %'
                OR title ILIKE 'Pin %' OR title ILIKE 'LK probe%' OR title ILIKE '%Скрин%'
                OR title ILIKE '%visual %')
           RETURNING id`,
          [meetingIds]
        );
        meetingsCleared = mdel.rowCount;
      }
      const del = await client.query(`DELETE FROM thing_rooms WHERE id = ANY($1::int[]) RETURNING id`, [ids]);
      deleted = del.rowCount;
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  }

  const left = await client.query(`SELECT count(*)::int AS n FROM thing_rooms`);
  const leftJunk = await client.query(
    `SELECT count(*)::int AS n FROM thing_rooms WHERE ${TITLE_SQL}`
  );
  await client.end();

  const md = [
    '# THING-PROD-CLEANUP',
    '',
    `at: ${new Date().toISOString()}`,
    `mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`,
    `host: ${process.env.DB_HOST || process.env.PGHOST}`,
    `database: ${process.env.DB_NAME || process.env.PGDATABASE}`,
    '',
    `candidates: ${rows.length}`,
    `deleted_rooms: ${deleted}`,
    `deleted_test_meetings: ${meetingsCleared}`,
    `thing_rooms_total_after: ${left.rows[0].n}`,
    `junk_remaining: ${leftJunk.rows[0].n}`,
    '',
    '## Sample (up to 40)',
    '',
    '| id | slug | title | status | created |',
    '|----|------|-------|--------|---------|',
    ...rows.slice(0, 40).map((r) =>
      `| ${r.id} | ${r.slug} | ${String(r.title).replace(/\|/g, '/')} | ${r.status} | ${r.created_at} |`
    ),
    '',
    APPLY ? '## Applied DELETE CASCADE via thing_rooms' : '## Dry-run only — set THING_CLEANUP_APPLY=1 to delete'
  ].join('\n');
  fs.writeFileSync(reportPath, md);
  console.log(md.split('\n').slice(0, 16).join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
