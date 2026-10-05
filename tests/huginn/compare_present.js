'use strict';

/**
 * Structural compare present boards vs FOR-REVIEW shots existence + size sanity.
 * Visual Read is for independent V1; this script gates missing artifacts.
 */

const fs = require('fs');
const path = require('path');

const PRESENT = path.join(__dirname, '../../prototypes/huginn/shots/present');
const REVIEW = path.join(__dirname, '../reports/huginn-ui/FOR-REVIEW/ROUND-3');
const REQUIRED_PRESENT = [
  'b-rail.png', 'b-huginn.png', 'b-thread.png', 'b-voice-play.png',
  'b-circle.png', 'b-stickers.png', 'b-story-post.png', 'b-ting.png'
];
const REQUIRED_REVIEW = [
  'dock-list.png', 'dock-collapsed.png', 'dock-thread.png',
  'dock-stickers.png', 'h-login.png', 'h-chat.png', 'BROWSER-REPORT.md'
];

const fails = [];
for (const f of REQUIRED_PRESENT) {
  const p = path.join(PRESENT, f);
  if (!fs.existsSync(p)) fails.push('missing present ' + f);
  else if (fs.statSync(p).size < 1000) fails.push('tiny present ' + f);
}
for (const f of REQUIRED_REVIEW) {
  const p = path.join(REVIEW, f);
  if (!fs.existsSync(p)) fails.push('missing FOR-REVIEW ' + f);
  else if (f.endsWith('.png') && fs.statSync(p).size < 500) fails.push('tiny FOR-REVIEW ' + f);
}

// Pairing map for V1
const pairs = [
  ['b-rail.png', 'dock-collapsed.png'],
  ['b-huginn.png', 'dock-list.png'],
  ['b-thread.png', 'dock-thread.png'],
  ['b-stickers.png', 'dock-stickers.png'],
  ['b-voice-play.png', 'dock-composer.png'],
  ['b-phones-d.png', 'h-chat.png']
];

const md = [
  '# Huginn present compare ROUND-3',
  '',
  `at: ${new Date().toISOString()}`,
  '',
  '| Present | FOR-REVIEW | Present bytes | Review bytes |',
  '|---|---|---:|---:|',
  ...pairs.map(([p, r]) => {
    const pb = fs.existsSync(path.join(PRESENT, p)) ? fs.statSync(path.join(PRESENT, p)).size : 0;
    const rb = fs.existsSync(path.join(REVIEW, r)) ? fs.statSync(path.join(REVIEW, r)).size : 0;
    return `| ${p} | ${r} | ${pb} | ${rb} |`;
  }),
  '',
  fails.length ? 'FAIL_LIST:\n' + fails.map((f) => '- ' + f).join('\n') : 'Artifact gate: PASS',
  '',
  'NOTE: Independent V1 must Read PNG pairs with vision; this script only checks artifacts exist.',
  fails.length ? 'VERDICT: FAIL' : 'VERDICT: ARTIFACTS_OK'
].join('\n');

fs.writeFileSync(path.join(REVIEW, 'PRESENT-COMPARE.md'), md);
console.log(md);
process.exit(fails.length ? 1 : 0);
