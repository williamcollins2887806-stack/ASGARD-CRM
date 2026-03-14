const { chromium } = require('playwright');
const path = require('path');

const SCENARIOS = [13, 15, 18, 22, 32];

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const summary = [];

  for (const num of SCENARIOS) {
    const padded = String(num).padStart(2, '0');
    const files = require('fs').readdirSync(path.join(__dirname, 'scenarios'));
    const file = files.find(f => f.startsWith(padded + '-'));
    if (!file) { console.log('Scenario ' + num + ': FILE NOT FOUND'); continue; }

    const mod = require('./scenarios/' + file);
    console.log('\n>>> SCENARIO ' + num + ' (' + file + ')');
    const start = Date.now();

    try {
      if (mod.tests && Array.isArray(mod.tests)) {
        // API-style test suite
        let passed = 0, failed = 0;
        for (const t of mod.tests) {
          try {
            await t.run();
            passed++;
          } catch(e) {
            failed++;
            console.log('  FAIL: ' + t.name + ' | ' + e.message.substring(0, 100));
          }
        }
        const dur = ((Date.now() - start) / 1000).toFixed(1);
        console.log('  Result: ' + passed + ' pass, ' + failed + ' fail (' + dur + 's)');
        summary.push({ num, passed, failed, dur });
      } else if (typeof mod.run === 'function') {
        // Playwright scenario
        const result = await mod.run(browser);
        const passed = result.steps.filter(s => s.status === 'PASSED').length;
        const failed = result.steps.filter(s => s.status === 'FAILED').length;
        const dur = ((Date.now() - start) / 1000).toFixed(1);
        result.steps.forEach(s => {
          if (s.status === 'FAILED') console.log('  FAIL: ' + s.name + ' | ' + (s.error || '').substring(0, 100));
        });
        console.log('  Result: ' + passed + ' pass, ' + failed + ' fail (' + dur + 's)');
        summary.push({ num, passed, failed, dur });
      }
    } catch(e) {
      console.log('  CRASH: ' + e.message.substring(0, 150));
      summary.push({ num, passed: 0, failed: 1, dur: ((Date.now() - start) / 1000).toFixed(1), crash: true });
    }
  }

  await browser.close();

  console.log('\n\n========== SUMMARY ==========');
  let totalPass = 0, totalFail = 0;
  for (const s of summary) {
    const icon = s.failed === 0 ? 'OK' : 'FAIL';
    console.log('  Scenario ' + s.num + ': ' + icon + ' (' + s.passed + ' pass, ' + s.failed + ' fail, ' + s.dur + 's)');
    totalPass += s.passed;
    totalFail += s.failed;
  }
  console.log('\nTOTAL: ' + totalPass + ' pass, ' + totalFail + ' fail');
  process.exit(totalFail > 0 ? 1 : 0);
})();
