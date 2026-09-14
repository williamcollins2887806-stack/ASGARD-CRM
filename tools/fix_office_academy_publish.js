#!/usr/bin/env node
'use strict';
const { Client } = require('pg');

(async () => {
  const c = new Client({
    host: '127.0.0.1', user: 'asgard', password: '123456789', database: 'asgard_crm',
  });
  await c.connect();
  const r = await c.query(`
    SELECT id, title, cover_icon,
      CASE WHEN blocks::text LIKE '%\\\\u%' THEN true ELSE false END AS blocks_esc,
      CASE WHEN title LIKE '%\\\\u%' THEN true ELSE false END AS title_esc,
      left(blocks::text, 180) AS sample,
      (SELECT count(*) FROM office_academy_quiz_questions q WHERE q.lesson_id = l.id) AS nq,
      (SELECT count(*) FROM office_academy_quiz_questions q WHERE q.lesson_id = l.id AND q.question_text LIKE '%\\\\u%') AS nq_esc
    FROM office_academy_lessons l
    WHERE id BETWEEN 1 AND 12
    ORDER BY id
  `);
  console.log(JSON.stringify(r.rows, null, 2));

  // Fix cover icons for tracks
  const icons = { pm: '⚙️', hr: '👥', finance: '💰', procurement: '📦', management: '🏛️', all: '🔒' };
  for (const [track, icon] of Object.entries(icons)) {
    await c.query(`
      UPDATE office_academy_lessons
      SET cover_icon = $1
      WHERE track = $2 AND (cover_icon IS NULL OR cover_icon = '' OR cover_icon ~ '[\\uD800-\\uDFFF]' OR length(cover_icon) > 8)
    `, [icon, track]);
  }

  // Archive stub drafts "Месяц N"
  const arch = await c.query(`
    UPDATE office_academy_lessons
    SET status = 'archived'
    WHERE status = 'draft' AND title ~* 'Месяц [0-9]+$'
    RETURNING id, title
  `);
  console.log('ARCHIVED STUBS', arch.rows);

  // Publish real drafts 7-12 that have content (blocks with text_block)
  const pub = await c.query(`
    UPDATE office_academy_lessons
    SET status = 'published', published_at = COALESCE(published_at, NOW())
    WHERE id BETWEEN 7 AND 12 AND status = 'draft'
      AND blocks::text LIKE '%text_block%'
    RETURNING id, title
  `);
  console.log('PUBLISHED DRAFTS', pub.rows);

  const st = await c.query(`SELECT status, count(*)::int n FROM office_academy_lessons GROUP BY 1 ORDER BY 1`);
  console.log('STATUS', st.rows);
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });
