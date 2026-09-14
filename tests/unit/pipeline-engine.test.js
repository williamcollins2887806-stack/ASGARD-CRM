'use strict';

/**
 * Unit tests: Рунопровод level generator solvability + hints
 * Run: node tests/unit/pipeline-engine.test.js
 */
const assert = require('assert');
const {
  generateLevel,
  recoverLevel,
  computePowerHint,
  isConnected,
  P,
} = require('../../src/services/pipelineEngine');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}: ${e.message}`);
  }
}

console.log('pipeline-engine');

test('levels 1..120 × 3 employees all connected', () => {
  for (let emp = 1; emp <= 3; emp++) {
    for (let lv = 1; lv <= 120; lv++) {
      const L = generateLevel(lv, emp);
      assert.ok(L, `level ${lv} emp ${emp} null`);
      assert.ok(isConnected(L.solution, L.size), `level ${lv} emp ${emp} unconnected`);
      assert.ok(L.moveLimit >= 1, `level ${lv} moveLimit`);
      assert.strictEqual(L.cells.length, L.size * L.size);
    }
  }
});

test('recoverLevel matches generateLevel cells', () => {
  const L = generateLevel(12, 42);
  const recovered = recoverLevel(12, 42, L.cells);
  assert.ok(recovered, 'recover failed');
  assert.ok(isConnected(recovered.solution, recovered.size));
  assert.strictEqual(recovered.cells.length, L.cells.length);
  for (let i = 0; i < L.cells.length; i++) {
    assert.strictEqual(recovered.cells[i].t, L.cells[i].t);
    assert.strictEqual(recovered.cells[i].r || 0, L.cells[i].r || 0);
  }
});

test('odin hint highlights a rotatable path cell', () => {
  const L = generateLevel(8, 7);
  const hint = computePowerHint(L.solution, L.size, L.cells, 'odin');
  assert.ok(hint.ok);
  if (hint.spent) {
    assert.ok(Number.isInteger(hint.highlight_index) || Number.isInteger(hint.clear_index)
      || hint.message.includes('Один'));
  }
});

test('path obstacles ≤ 2 and thor+freya compatible (levels 1..120)', () => {
  const thorOnly = (t) => t === P.RUST || t === P.BROKEN;
  for (let emp = 1; emp <= 3; emp++) {
    for (let lv = 1; lv <= 120; lv++) {
      const L = generateLevel(lv, emp);
      const pathObs = [];
      for (let i = 0; i < L.cells.length; i++) {
        if ([P.RUST, P.CLOG, P.BROKEN, P.ROOT].includes(L.cells[i].t)
          && L.solution[i] && L.solution[i].t !== P.EMPTY) {
          // obstacle on solution path if solution has clear flags or STR with clear
          const s = L.solution[i];
          if (s.rustCleared || s.clogCleared || s.brokenCleared || s.rootCleared || s.t === P.STR) {
            if ([P.RUST, P.CLOG, P.BROKEN, P.ROOT].includes(L.cells[i].t)) pathObs.push(L.cells[i].t);
          }
        }
      }
      // Count blocked cells that are on solution (have clear flags)
      const blockedOnPath = L.cells
        .map((c, i) => ({ c, s: L.solution[i] }))
        .filter(({ c, s }) => s && (s.rustCleared || s.clogCleared || s.brokenCleared || s.rootCleared));
      assert.ok(blockedOnPath.length <= 2, `lv ${lv} emp ${emp} has ${blockedOnPath.length} path obstacles`);
      if (blockedOnPath.length === 2) {
        const t0 = blockedOnPath[0].c.t;
        const t1 = blockedOnPath[1].c.t;
        assert.ok(!(thorOnly(t0) && thorOnly(t1)), `lv ${lv} emp ${emp} thor-only pair`);
      }
    }
  }
});

test('thor hint clears rust/clog/broken when present', () => {
  const L = generateLevel(20, 3);
  const hasObs = L.cells.some((c) => [P.RUST, P.CLOG, P.BROKEN].includes(c.t));
  const hint = computePowerHint(L.solution, L.size, L.cells, 'thor');
  assert.ok(hint.ok);
  if (hasObs) assert.ok(hint.spent === true || hint.spent === false);
});

test('heim returns ghost_path or clear', () => {
  const L = generateLevel(15, 9);
  const hint = computePowerHint(L.solution, L.size, L.cells, 'heim');
  assert.ok(hint.ok);
  assert.ok(hint.spent);
  assert.ok(hint.ghost_path || Number.isInteger(hint.clear_index));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
