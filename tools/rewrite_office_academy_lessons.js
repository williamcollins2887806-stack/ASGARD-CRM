#!/usr/bin/env node
/**
 * Перевыпуск published-уроков Академии Асгарда на новый контент-стандарт.
 *
 * Usage:
 *   node tools/rewrite_office_academy_lessons.js              # все published
 *   node tools/rewrite_office_academy_lessons.js --needs-only # только needs_rewrite
 *   node tools/rewrite_office_academy_lessons.js --id=42      # один урок
 *   node tools/rewrite_office_academy_lessons.js --force      # публиковать даже если gate слабый
 *
 * Требует рабочий AI provider и БД (как у сервера).
 */
'use strict';

const path = require('path');
process.chdir(path.join(__dirname, '..'));

async function main() {
  const args = process.argv.slice(2);
  const needsOnly = args.includes('--needs-only');
  const forcePublish = args.includes('--force');
  const idArg = args.find((a) => a.startsWith('--id='));
  const oneId = idArg ? parseInt(idArg.split('=')[1], 10) : null;

  const cron = require('../src/services/office-academy-cron');

  if (oneId) {
    console.log(`[rewrite] Single lesson #${oneId}…`);
    const r = await cron.rewriteLesson(oneId, { forcePublish });
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  }

  console.log(`[rewrite] Batch${needsOnly ? ' (needs_rewrite only)' : ''}…`);
  const results = await cron.rewriteAllPublished({ onlyNeedsRewrite: needsOnly, forcePublish });
  const ok = results.filter((r) => r.ok).length;
  const fail = results.length - ok;
  console.log(`[rewrite] Done: ${ok} ok, ${fail} fail / ${results.length}`);
  for (const r of results) {
    console.log(`  #${r.id} ${r.ok ? '→ #' + r.new_id : 'FAIL'} ${r.title || ''} ${r.error || ''}`);
  }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
