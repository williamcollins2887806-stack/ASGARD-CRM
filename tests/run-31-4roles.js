#!/usr/bin/env node
// Run test 31 for only 4 fixed roles
const { chromium } = require('playwright');
const path = require('path');
const config = require('./config');

// Override ROLES to only test the 4 fixed roles
config.ROLES.length = 0;
config.ROLES.push('HEAD_PM', 'HEAD_TO', 'CHIEF_ENGINEER', 'HR_MANAGER');
console.log('Testing roles:', config.ROLES.join(', '));

const test31 = require('./scenarios/31-deep-button-audit.test');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  try {
    const result = await test31.run(browser, config);
    console.log('\n' + '='.repeat(60));
    console.log('RESULT: ' + result.status);
    console.log('='.repeat(60));
    if (result.steps) {
      result.steps.forEach(s => {
        console.log((s.status === 'PASSED' ? 'PASS' : 'FAIL') + ' ' + s.name + (s.note ? ' (' + s.note + ')' : ''));
        if (s.error) console.log('  ERROR: ' + s.error);
      });
    }
  } catch(e) {
    console.error('FATAL:', e.message);
  } finally {
    await browser.close();
  }
})();
