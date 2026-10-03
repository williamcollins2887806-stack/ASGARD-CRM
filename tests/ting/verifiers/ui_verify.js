#!/usr/bin/env node
/**
 * Static UI contract vs plan (Telemost + Ting + prod feedback).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../../..');
const report = path.join(root, 'tests/reports/THING-UI-VERIFY-F4.md');

const tingPage = fs.readFileSync(path.join(root, 'public/assets/js/ting_page.js'), 'utf8');
const tingCss = fs.readFileSync(path.join(root, 'public/assets/css/ting.css'), 'utf8');
const guest = fs.readFileSync(path.join(root, 'public/ting/index.html'), 'utf8');

const checks = [];
function check(id, pass, evidence) {
  checks.push({ id, pass: !!pass, evidence: String(evidence || '') });
}

check('U01_hub_hero', /ting-hub-hero|ting-hub-card/.test(tingPage + tingCss), 'hub hero cards');
check('U02_call_rows', /ting-call-row|ting-day/.test(tingPage + tingCss), 'call history rows');
check('U03_radius', /--ting-radius:\s*22px/.test(tingCss), 'Telemost-like radius');
check('U04_dock_float', /ting-dock-inner/.test(tingCss), 'floating dock');
check('U05_tile_overlay', /\.ting-tile \.lbl/.test(tingCss), 'tile name overlay');
check('U06_chat_grid', /grid-template-areas:[\s\S]*chat/.test(tingCss), 'chat in grid');
check('U07_incall', /body\.ting-incall/.test(tingCss), 'hide CRM chrome');
check('U08_guest_shared', /ting\.css/.test(guest) && /ting-room-shell/.test(guest), 'guest shared shell');
check('U09_ru_copy', /Удалить из комнаты/.test(tingPage) && /Новый Тинг/.test(tingPage), 'RU copy');
check('U10_logo', /ting-logo-mark/.test(tingPage), 'logo');
check('U11_speaker', /speaker/.test(tingPage) && /ting-stage\.speaker/.test(tingCss), 'speaker layout');
check('U12_mobile_sheets', /ting-chat\.open/.test(tingCss) && /ting-people-drawer/.test(tingCss), 'mobile chat/people sheets');
check('U13_no_modul', !/модуль CRM/.test(tingPage), 'no modul CRM');
check('U14_qr', /ting-qr/.test(tingPage + tingCss), 'QR box');
check('U15_proto_contrast', /\.ting-proto-doc[\s\S]*color:\s*#1a1a1a/.test(tingCss), 'protocol contrast');

const fail = checks.filter((c) => !c.pass);
const md = [
  '# THING-UI-VERIFY-F4',
  '',
  `at: ${new Date().toISOString()}`,
  `result: ${fail.length ? 'FAIL' : 'VERIFIED'} (${checks.length - fail.length}/${checks.length})`,
  '',
  '| ID | PASS | Evidence |',
  '|----|------|----------|',
  ...checks.map((c) => `| ${c.id} | ${c.pass ? 'PASS' : 'FAIL'} | ${c.evidence} |`),
  '',
  fail.length ? fail.map((f) => `- FAIL ${f.id}`).join('\n') : 'All PASS'
].join('\n');
fs.writeFileSync(report, md);
console.log(md.split('\n').slice(0, 8).join('\n'));
fail.forEach((f) => console.log('FAIL', f.id));
process.exit(fail.length ? 1 : 0);
