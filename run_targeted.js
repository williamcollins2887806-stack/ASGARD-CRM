const config = require("./tests/config");
const { SkipError, api, assertOk, assert, skip, getAccount } = config;

async function runTestSuite(suite) {
  const out = [];
  console.log(`\n  > ${suite.name} (${suite.tests.length} tests)`);
  for (const test of suite.tests) {
    const t0 = Date.now();
    try {
      await test.run();
      const ms = Date.now() - t0;
      console.log(`    PASS ${test.name} (${ms}ms)`);
      out.push({ name: test.name, status: "PASS", ms });
    } catch (err) {
      const ms = Date.now() - t0;
      if (err instanceof SkipError || err.name === "SkipError") {
        console.log(`    SKIP ${test.name}: ${err.message}`);
        out.push({ name: test.name, status: "SKIP", ms });
      } else {
        console.log(`    FAIL ${test.name}: ${err.message.slice(0, 300)}`);
        out.push({ name: test.name, status: "FAIL", ms });
      }
    }
  }
  const p = out.filter(r=>r.status==="PASS").length;
  const f = out.filter(r=>r.status==="FAIL").length;
  const s = out.filter(r=>r.status==="SKIP").length;
  console.log(`  == ${p} pass, ${f} fail, ${s} skip`);
  return out;
}

async function main() {
  console.log("=== TARGETED TEST RUN ===");
  await config.initTokens();

  // 1. PM-Analytics API
  console.log("\n--- PM-ANALYTICS ---");
  try {
    const r1 = await api("GET", "/api/reports/pm-analytics", { role: "ADMIN" });
    if (r1.status >= 200 && r1.status < 300) console.log("  PASS pm-analytics ADMIN: " + r1.status);
    else console.log("  FAIL pm-analytics ADMIN: " + r1.status + " " + JSON.stringify(r1.data).slice(0,200));

    const r2 = await api("GET", "/api/reports/pm-analytics", { role: "PM" });
    if (r2.status >= 200 && r2.status < 400) console.log("  PASS pm-analytics PM: " + r2.status);
    else console.log("  FAIL pm-analytics PM: " + r2.status + " " + JSON.stringify(r2.data).slice(0,200));
  } catch(e) { console.log("  ERROR: " + e.message); }

  // 2. Equipment create test
  console.log("\n--- EQUIPMENT CREATE ---");
  try {
    const r = await api("POST", "/api/equipment", { role: "ADMIN", body: { name: "Targeted-Test-" + Date.now(), category_id: 1 }});
    if (r.status >= 200 && r.status < 300) {
      console.log("  PASS equipment create: id=" + r.data?.equipment?.id + " qr=" + r.data?.equipment?.qr_uuid);
      if (r.data?.equipment?.id) await api("DELETE", "/api/equipment/" + r.data.equipment.id, { role: "ADMIN" });
    } else console.log("  FAIL equipment create: " + r.status + " " + JSON.stringify(r.data).slice(0,200));
  } catch(e) { console.log("  ERROR: " + e.message); }

  // 3. E2E equipment flow
  console.log("\n--- E2E EQUIPMENT FLOW ---");
  const eqFlow = require("./tests/e2e/flow-equipment-maintenance.test.js");
  if (eqFlow.tests) await runTestSuite(eqFlow);

  // 4. E2E equipment premium (has edge case)
  console.log("\n--- E2E EQUIPMENT PREMIUM ---");
  const eqPrem = require("./tests/e2e/flow-equipment-premium.test.js");
  if (eqPrem.tests) await runTestSuite(eqPrem);

  // 5. Scenario 32
  console.log("\n--- SCENARIO 32 ---");
  const sc32 = require("./tests/scenarios/32-site-inspection-workflow.test.js");
  if (sc32.tests) await runTestSuite(sc32);

  // 6. Scenario 18 (Playwright)
  console.log("\n--- SCENARIO 18 (Playwright) ---");
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox","--disable-dev-shm-usage"] });
  const sc18 = require("./tests/scenarios/18-equipment-procurement.test.js");
  const result = await sc18.run(browser, {});
  const steps = result.steps || [];
  const pass = steps.filter(s => s.status === "PASSED").length;
  const fail = steps.filter(s => s.status === "FAILED").length;
  console.log(`  == ${pass} pass, ${fail} fail`);
  steps.filter(s => s.status === "FAILED").forEach(s => console.log(`    FAIL ${s.name}: ${s.error}`));

  // 7. Smoke: PROC/WAREHOUSE/PM home
  console.log("\n--- SMOKE: PROC/WAREHOUSE/PM ---");
  for (const role of ["PROC","WAREHOUSE","PM"]) {
    const acc = getAccount(role);
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    try {
      const { loginAs, sleep } = require("./tests/lib/auth");
      await loginAs(page, acc);
      const errors = [];
      page.on("pageerror", e => errors.push(e.message));
      await page.goto(config.BASE_URL + "/#/home", { waitUntil: "domcontentloaded", timeout: 15000 });
      await sleep(3000);
      const body = await page.locator("body").textContent().catch(() => "");
      if (body.includes("403")) console.log(`  FAIL ${role} #/home: 403`);
      else if (body.length < 100) console.log(`  FAIL ${role} #/home: empty`);
      else if (errors.length > 0) console.log(`  WARN ${role} #/home: JS errors: ${errors.join("; ").slice(0,200)}`);
      else console.log(`  PASS ${role} #/home: OK (${body.length} chars)`);
    } catch(e) { console.log(`  FAIL ${role}: ${e.message.slice(0,200)}`); }
    await ctx.close();
  }

  await browser.close();
  console.log("\n=== DONE ===");
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
