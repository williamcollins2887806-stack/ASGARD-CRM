'use strict';

const path = require('path');
const fs = require('fs');
const { assertLocalDb, DEFAULT_DATABASE_URL } = require('./harness');

const scenariosDir = path.join(__dirname);

function parseArgs(argv) {
  const out = { all: false, only: null };
  for (const a of argv.slice(2)) {
    if (a === '--all') out.all = true;
    else if (a.startsWith('--only=')) out.only = a.slice('--only='.length);
  }
  if (!out.all && !out.only) out.all = true;
  return out;
}

function loadScenarios(only) {
  const files = fs
    .readdirSync(scenariosDir)
    .filter((f) => /^S\d+(_[a-z0-9_]+)?\.js$/i.test(f))
    .sort((a, b) => {
      const na = parseInt(a.match(/^S(\d+)/i)[1], 10);
      const nb = parseInt(b.match(/^S(\d+)/i)[1], 10);
      if (na !== nb) return na - nb;
      return a.localeCompare(b);
    });
  return files
    .filter((f) => {
      if (!only) return true;
      const id = f.replace(/\.js$/i, '');
      return id.toUpperCase() === only.toUpperCase();
    })
    .map((f) => {
      const mod = require(path.join(scenariosDir, f));
      const id = mod.id || f.replace(/\.js$/, '');
      return { id, file: f, run: mod.run };
    });
}

async function main() {
  try {
    assertLocalDb(process.env.DATABASE_URL || DEFAULT_DATABASE_URL);
  } catch (e) {
    console.error('DB guard:', e.message);
    process.exit(1);
  }

  const args = parseArgs(process.argv);
  const list = loadScenarios(args.only);
  if (!list.length) {
    console.error('No integration scenarios matched');
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const sc of list) {
    process.stdout.write(`[${sc.id}] `);
    try {
      const r = await sc.run();
      if (r && r.skip) {
        skipped++;
        console.log(`SKIP: ${r.skip}`);
      } else {
        passed++;
        console.log('OK');
      }
    } catch (e) {
      failed++;
      console.log('FAIL');
      console.error(`  ${e.message}`);
      if (e.stack) console.error(e.stack.split('\n').slice(1, 5).join('\n'));
    }
  }

  console.log(`\nIntegration: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  process.exit(failed ? 1 : 0);
}

main();
