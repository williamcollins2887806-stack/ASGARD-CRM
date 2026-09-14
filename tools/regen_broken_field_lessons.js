'use strict';
/**
 * Перегенерация 8 field-уроков (curriculum 39–46 → absolute weeks 135–142).
 * Запуск на проде из /var/www/asgard-crm:
 *   node tools/regen_broken_field_lessons.js
 */
require('dotenv').config();

async function main() {
  const academy = require('../src/services/academy-cron');
  const db = require('../src/services/db');

  // Сверяем слоты с тем, что реально в БД
  const { rows } = await db.query(`
    SELECT id, week_number, saga, title, status
    FROM academy_lessons
    WHERE week_number BETWEEN 135 AND 142
    ORDER BY week_number, id
  `);
  console.log('[regen] current weeks 135-142:');
  for (const r of rows) {
    console.log(`  #${r.id} w${r.week_number} [${r.status}] ${r.saga} — ${r.title}`);
  }

  console.log('[regen] starting regenerateBrokenCurriculumWeeks…');
  const created = await academy.regenerateBrokenCurriculumWeeks({
    baseWeek: 135,
    curriculumWeeks: [39, 40, 41, 42, 43, 44, 45, 46],
    maxAttempts: 4,
  });
  console.log('[regen] created:', JSON.stringify(created, null, 2));

  // Verify quiz shape of new published lessons
  const { rows: check } = await db.query(`
    SELECT al.id, al.week_number, al.saga, al.status,
      COUNT(aq.id) AS q_count,
      COUNT(*) FILTER (
        WHERE jsonb_typeof(aq.options) = 'array'
          AND jsonb_array_length(aq.options) >= 2
          AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(aq.options) o
            WHERE jsonb_typeof(o) = 'string'
               OR COALESCE(NULLIF(trim(o->>'text'), ''), NULL) IS NULL
               OR (o->>'id') IS NULL OR trim(o->>'id') = ''
          )
          AND (
            SELECT COUNT(*) FROM jsonb_array_elements(aq.options) o
            WHERE (o->>'is_correct') IN ('true','t','1')
               OR (o->>'is_correct')::boolean IS TRUE
          ) = 1
      ) AS q_ok
    FROM academy_lessons al
    LEFT JOIN academy_quiz_questions aq ON aq.lesson_id = al.id
    WHERE al.week_number BETWEEN 135 AND 142
      AND al.status = 'published'
    GROUP BY al.id
    ORDER BY al.week_number
  `);
  console.log('[regen] published quiz health:');
  for (const r of check) {
    const ok = Number(r.q_count) > 0 && Number(r.q_count) === Number(r.q_ok);
    console.log(`  ${ok ? 'OK' : 'FAIL'} #${r.id} w${r.week_number} ${r.saga} q=${r.q_ok}/${r.q_count}`);
  }

  const health = await academy.auditPublishedQuizHealth();
  console.log('[regen] field health after:', health);

  const office = require('../src/services/office-academy-cron');
  const oh = await office.auditPublishedOfficeQuizHealth();
  console.log('[regen] office health:', oh);

  process.exit(0);
}

main().catch((e) => {
  console.error('[regen] FATAL', e);
  process.exit(1);
});
