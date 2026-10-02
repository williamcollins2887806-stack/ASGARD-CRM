'use strict';

const path = require('path');
const fs = require('fs');

const scenariosDir = path.join(__dirname, 'scenarios');

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
    .filter((f) => /^S\d+\.js$/i.test(f))
    .sort();
  return files
    .filter((f) => {
      if (!only) return true;
      const id = f.replace(/^([^.]+).*/, '$1');
      return id.toUpperCase() === only.toUpperCase();
    })
    .map((f) => {
      const mod = require(path.join(scenariosDir, f));
      const id = mod.id || f.replace(/\.js$/, '');
      return { id, file: f, run: mod.run };
    });
}

async function main() {
  const args = parseArgs(process.argv);
  const list = loadScenarios(args.only);
  if (!list.length) {
    console.error('No scenarios matched');
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;

  for (const sc of list) {
    process.stdout.write(`[${sc.id}] `);
    try {
      await sc.run();
      passed++;
      console.log('OK');
    } catch (e) {
      failed++;
      console.log('FAIL');
      console.error(`  ${e.message}`);
      if (e.stack) console.error(e.stack.split('\n').slice(1, 4).join('\n'));
    }
  }

  console.log(`\nScenarios: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
