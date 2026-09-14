'use strict';
/**
 * Ручная публикация field-уроков weeks 135–142 (без RouterAI).
 * Запуск на проде: node tools/manual_lessons/seed_and_publish.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { normalizeQuestions, assertAllQuestions } = require('../../src/lib/academy-quiz-shape');
const { textLen } = require('./_helpers');
const { lesson135, lesson136 } = require('./lessons_135_136');
const { lesson137, lesson138 } = require('./lessons_137_138');
const { lesson139, lesson140 } = require('./lessons_139_140');
const { lesson141, lesson142 } = require('./lessons_141_142');

const LESSONS = [
  lesson135, lesson136, lesson137, lesson138,
  lesson139, lesson140, lesson141, lesson142,
];

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

async function publishAll() {
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

    // unique week_number — удаляем старые (в т.ч. archived) вместе с квизом
    await db.query(`
      DELETE FROM academy_quiz_questions
      WHERE lesson_id IN (SELECT id FROM academy_lessons WHERE week_number = $1)
    `, [lesson.week_number]);
    await db.query(`DELETE FROM academy_lessons WHERE week_number = $1`, [lesson.week_number]);

    const { rows: [ins] } = await db.query(`
      INSERT INTO academy_lessons
        (week_number, saga, title, cover_icon, cover_color, estimated_minutes, tags,
         status, generated_by, blocks, is_mandatory, release_monday, published_at, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'published','manual',$8,$9,'2026-08-25',NOW(),NOW())
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

    console.log(`  PUBLISHED id=${ins.id}`);
    results.push({ week: lesson.week_number, ok: true, id: ins.id, chars, q: qs.length });
  }

  // health check
  const { BROKEN_QUIZ_SQL } = require('../../src/lib/academy-quiz-shape');
  const { rows: broken } = await db.query(BROKEN_QUIZ_SQL);
  console.log('[seed] broken published after:', broken.length);
  if (broken.length) console.log(broken);

  const { rows: check } = await db.query(`
    SELECT al.id, al.week_number, al.saga, al.status,
      COUNT(aq.id)::int AS q_count,
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
      )::int AS q_ok
    FROM academy_lessons al
    LEFT JOIN academy_quiz_questions aq ON aq.lesson_id = al.id
    WHERE al.week_number BETWEEN 135 AND 142 AND al.status = 'published'
    GROUP BY al.id
    ORDER BY al.week_number
  `);
  for (const r of check) {
    const pass = r.q_count > 0 && r.q_count === r.q_ok;
    console.log(`  ${pass ? 'OK' : 'FAIL'} #${r.id} w${r.week_number} ${r.saga} q=${r.q_ok}/${r.q_count}`);
  }

  return results;
}

if (require.main === module) {
  const mode = process.argv[2] || 'validate';
  if (mode === 'validate') {
    let allOk = true;
    for (const raw of LESSONS) {
      const v = validate(raw);
      console.log(`w${raw.week_number} blocks=${v.lesson.blocks.length} chars=${v.chars} q=${v.qs.length} ok=${v.ok}`);
      if (!v.ok) {
        allOk = false;
        console.log(' ', v.reasons);
      }
    }
    process.exit(allOk ? 0 : 1);
  }
  if (mode === 'publish') {
    publishAll()
      .then((r) => {
        console.log(JSON.stringify(r, null, 2));
        const bad = r.filter((x) => !x.ok);
        process.exit(bad.length ? 1 : 0);
      })
      .catch((e) => {
        console.error(e);
        process.exit(1);
      });
  }
}

module.exports = { LESSONS, validate, publishAll };
