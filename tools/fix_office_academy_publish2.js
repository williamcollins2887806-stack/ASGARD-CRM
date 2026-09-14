#!/usr/bin/env node
'use strict';
const { Client } = require('pg');

(async () => {
  const c = new Client({
    host: '127.0.0.1', user: 'asgard', password: '123456789', database: 'asgard_crm',
  });
  await c.connect();

  const icons = { pm: '⚙️', hr: '👥', finance: '💰', procurement: '📦', management: '🏛️', all: '🔒' };
  for (const [track, icon] of Object.entries(icons)) {
    const r = await c.query(
      `UPDATE office_academy_lessons SET cover_icon = $1 WHERE track = $2 RETURNING id`,
      [icon, track]
    );
    console.log(`icons ${track}: ${r.rowCount}`);
  }

  // Publish remaining content drafts (not stubs)
  const pub = await c.query(`
    UPDATE office_academy_lessons
    SET status = 'published', published_at = COALESCE(published_at, NOW())
    WHERE status = 'draft'
      AND title !~* 'Месяц [0-9]+$'
      AND blocks IS NOT NULL
      AND jsonb_typeof(blocks) = 'array'
      AND jsonb_array_length(blocks) >= 3
    RETURNING id, title, track
  `);
  console.log('PUBLISHED', pub.rows);

  const st = await c.query(`SELECT status, count(*)::int n FROM office_academy_lessons GROUP BY 1 ORDER BY 1`);
  console.log('STATUS', st.rows);

  // Sample published lesson 6 for UI
  const s = await c.query(`SELECT id, title, cover_icon, status FROM office_academy_lessons WHERE id IN (1,6,7,12) ORDER BY id`);
  console.log('SAMPLE', s.rows);
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });
