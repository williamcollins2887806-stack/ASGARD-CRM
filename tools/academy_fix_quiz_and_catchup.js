/**
 * One-shot: reshuffle published academy quiz options + generate missed weekly lesson(s).
 * Run on prod: node tools/academy_fix_quiz_and_catchup.js
 */
'use strict';

require('dotenv').config();

async function main() {
  const academy = require('../src/services/academy-cron');
  console.log('[fix] reshuffle published quiz options…');
  const reshuffle = await academy.reshufflePublishedQuizOptions();
  console.log('[fix] reshuffle done:', reshuffle);

  // Catch up missed Sundays since last published week (max 142 on 2026-08-30).
  // Generate until current curriculum week is covered (at least one new lesson).
  console.log('[fix] generate missed weekly lesson(s)…');
  let generated = [];
  for (let i = 0; i < 2; i++) {
    try {
      const id = await academy.generateWeeklyLesson({ maxAttempts: 4 });
      if (id) {
        generated.push(id);
        console.log('[fix] generated lesson id=', id);
      } else {
        console.log('[fix] generate returned empty (skip/covered)');
        break;
      }
    } catch (e) {
      console.error('[fix] generate failed:', e.message);
      // one more outer retry with fresh attempts
      try {
        const id2 = await academy.generateWeeklyLesson({ maxAttempts: 4 });
        if (id2) {
          generated.push(id2);
          console.log('[fix] generated lesson (retry) id=', id2);
        }
      } catch (e2) {
        console.error('[fix] generate retry failed:', e2.message);
      }
      break;
    }
  }

  console.log(JSON.stringify({ ok: true, reshuffle, generated }, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
