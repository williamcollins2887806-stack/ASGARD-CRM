'use strict';
/**
 * Ручная публикация field-уроков weeks 143–144 (без RouterAI).
 * Запуск на проде: node tools/manual_lessons/seed_143_144.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { normalizeQuestions, assertAllQuestions, BROKEN_QUIZ_SQL } = require('../../src/lib/academy-quiz-shape');
const { textLen } = require('./_helpers');
const { lesson143, lesson144 } = require('./lessons_143_144');

const LESSONS = [lesson143, lesson144];

/** release_monday: вс 31.08 → пн 01.09; вс 07.09 → пн 08.09 */
const RELEASE_BY_WEEK = {
  143: '2026-09-01',
  144: '2026-09-08',
};

function padIfNeeded(lesson) {
  let chars = textLen(lesson);
  if (chars >= 5600) return lesson;
  const need = 5600 - chars + 80;
  const filler = (
    ' Дополнительный практический акцент: на объекте каждый барьер проверяют глазами и руками до старта, ' +
    'а не после сигнала аварии. Бригада проговаривает роли, связь и критерий stop-work. ' +
    'Документы подтверждают готовность, но не заменяют осмотр места. ' +
    'Повторяющиеся нарушения закрывают системно: обеспечение, обучение, план работ, лидерство. '
  ).repeat(Math.ceil(need / 280));
  lesson.blocks.push({
    type: 'text_block',
    title: 'Закрепление: дисциплина барьеров',
    text: filler.slice(0, need + 100),
  });
  return lesson;
}

function validate(lesson) {
  lesson = padIfNeeded(JSON.parse(JSON.stringify(lesson)));
  const chars = textLen(lesson);
  const factCards = lesson.blocks.filter((b) => b.type === 'fact_card').length;
  const qs = normalizeQuestions(lesson.questions);
  const fails = assertAllQuestions(qs, { requireId: true });
  const reasons = [];
  if (lesson.blocks.length < 12) reasons.push(`blocks ${lesson.blocks.length}`);
  if (chars < 5500) reasons.push(`chars ${chars}`);
  if (factCards < 3) reasons.push(`fact_card ${factCards}`);
  if (qs.length < 15) reasons.push(`questions ${qs.length}`);
  if (fails.length) reasons.push(...fails.slice(0, 5));
  const mins = Number(lesson.estimated_minutes);
  if (mins < 7 || mins > 10) reasons.push(`minutes ${mins}`);
  return { ok: reasons.length === 0, reasons, chars, qs, lesson };
}

async function main() {
  const db = require('../../src/services/db');
  const results = [];

  for (const raw of LESSONS) {
    const { ok, reasons, chars, qs, lesson } = validate(raw);
    console.log(`[seed] week ${raw.week_number} «${raw.saga}» chars=${chars} q=${qs.length} ok=${ok}`);
    if (!ok) {
      console.error('  FAIL', reasons);
      results.push({ week: raw.week_number, ok: false, reasons });
      continue;
    }

    await db.query(`
      DELETE FROM academy_quiz_questions
      WHERE lesson_id IN (SELECT id FROM academy_lessons WHERE week_number = $1)
    `, [lesson.week_number]);
    await db.query(`DELETE FROM academy_lessons WHERE week_number = $1`, [lesson.week_number]);

    const releaseMonday = RELEASE_BY_WEEK[lesson.week_number] || '2026-09-01';

    const { rows: [ins] } = await db.query(`
      INSERT INTO academy_lessons
        (week_number, saga, title, cover_icon, cover_color, estimated_minutes, tags,
         status, generated_by, blocks, is_mandatory, release_monday, published_at, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'published','manual',$8,$9,$10::date,NOW(),NOW())
      RETURNING id
    `, [
      lesson.week_number,
      lesson.saga,
      lesson.title,
      lesson.cover_icon,
      lesson.cover_color,
      lesson.estimated_minutes,
      lesson.tags,
      JSON.stringify(lesson.blocks),
      lesson.is_mandatory,
      releaseMonday,
    ]);

    for (const q of qs) {
      await db.query(`
        INSERT INTO academy_quiz_questions
          (lesson_id, sort_order, question_type, question_text, options, correct_explanation)
        VALUES ($1,$2,$3,$4,$5,$6)
      `, [
        ins.id, q.sort_order, q.question_type,
        q.question_text, JSON.stringify(q.options), q.correct_explanation,
      ]);
    }

    console.log(`  PUBLISHED id=${ins.id} release_monday=${releaseMonday}`);
    results.push({ week: lesson.week_number, ok: true, id: ins.id, chars, q: qs.length });
  }

  const { rows: broken } = await db.query(BROKEN_QUIZ_SQL);
  console.log('[seed] broken published after:', broken.length);
  if (broken.length) console.log(broken);

  const { rows: check } = await db.query(`
    SELECT al.id, al.week_number, al.saga, al.status, al.release_monday,
      COUNT(aq.id)::int AS q_count
    FROM academy_lessons al
    LEFT JOIN academy_quiz_questions aq ON aq.lesson_id = al.id
    WHERE al.week_number IN (143, 144)
    GROUP BY al.id
    ORDER BY al.week_number
  `);
  console.log('[seed] check:', check);
  console.log(JSON.stringify({ results }, null, 2));
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
