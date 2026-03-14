'use strict';

const suites = [
  require("./mango-service.test"),
  require("./pipeline.test"),
  require("./webhook-handler.test"),
  require("./api-endpoints.test"),
  require("./field-validation.test"),
];

const optionalSuites = [
  "./routing.test",
  "./call-analyzer.test",
  "./speechkit-service.test",
  "./voice-agent.test"
];

for (const modPath of optionalSuites) {
  try {
    suites.push(require(modPath));
  } catch (e) {
    console.log("  [skip] " + modPath + " - " + e.message);
  }
}

async function run() {
  let passed = 0, failed = 0, skipped = 0;
  const failures = [];

  for (const suite of suites) {
    console.log("");
    console.log("=== " + suite.name + " ===");
    for (const t of suite.tests) {
      try {
        await t.run();
        console.log("  PASS: " + t.name);
        passed++;
      } catch (e) {
        if (e && e.constructor && e.constructor.name === "SkipError") {
          console.log("  SKIP: " + t.name + " - " + e.message);
          skipped++;
        } else {
          console.log("  FAIL: " + t.name + " - " + (e ? e.message : e));
          failed++;
          failures.push({ name: t.name, error: e ? e.message : String(e) });
        }
      }
    }
  }

  console.log("");
  console.log("========== RESULTS ==========");
  console.log("Passed:  " + passed);
  console.log("Failed:  " + failed);
  console.log("Skipped: " + skipped);
  console.log("Total:   " + (passed + failed + skipped));

  if (failures.length > 0) {
    console.log("");
    console.log("--- Failures ---");
    for (const f of failures) {
      console.log("  " + f.name + ": " + f.error);
    }
  }

  console.log("");
  console.log(failed === 0 ? "ALL TESTS PASSED" : failed + " TEST(S) FAILED");
  return { passed, failed, skipped };
}

module.exports = { name: "Telephony Tests", suites, run };

if (require.main === module) {
  run().then(r => {
    process.exit(r.failed > 0 ? 1 : 0);
  }).catch(e => {
    console.error("Fatal:", e);
    process.exit(2);
  });
}
