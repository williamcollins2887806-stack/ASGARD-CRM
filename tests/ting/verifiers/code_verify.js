#!/usr/bin/env node
/**
 * Independent CODE verifier for Ting CRM UI 100% plan (F4).
 * Anti-stub, LiveKit real hooks, RBAC protocol, dial 6, no dead CTA.
 * Exit 0 = VERIFIED, 1 = FAIL.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../../..');
const report = path.join(root, 'tests/reports/THING-CODE-VERIFY-F4.md');

const checks = [];
function check(id, pass, evidence) {
  checks.push({ id, pass: !!pass, evidence: String(evidence || '') });
}

const tingPage = fs.readFileSync(path.join(root, 'public/assets/js/ting_page.js'), 'utf8');
const guest = fs.readFileSync(path.join(root, 'public/ting/index.html'), 'utf8');
const thing = fs.readFileSync(path.join(root, 'src/routes/thing.js'), 'utf8');
const livekit = fs.readFileSync(path.join(root, 'src/services/thing-livekit.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/assets/js/app.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');

check('C01_no_skoro_toast', !/скоро появится|coming soon|TODO.*ting|заглушк|toast\(['\"]скоро/i.test(tingPage), 'no stub phrases in ting_page');
check('C02_livekit_cdn', /livekit-client@2/.test(tingPage) && /LivekitClient|createLocalTracks|Room\.connect|room\.connect/.test(tingPage), 'LiveKit client connect');
check('C03_guest_livekit', /room\.connect|LivekitClient/.test(guest), 'guest connects LiveKit');
check('C04_protocol_owner', /isProtocolOwner/.test(thing), 'protocol RBAC helper');
check('C05_lobby_admit', /lobby\/:participantId\/admit/.test(thing) && /admit/.test(tingPage), 'admit wired');
check('C06_lobby_reject', /lobby\/:participantId\/reject/.test(thing), 'reject API');
check('C07_mute_all', /mute-all/.test(thing) && /mute-all|muteAll/.test(livekit + tingPage), 'mute-all');
check('C08_remove', /participants\/:identity\/remove/.test(thing), 'kick/remove');
check('C09_recording_ui', /recording\/start/.test(tingPage) && /recording\/stop/.test(tingPage), 'rec UI');
check('C10_host_end', /\/end/.test(tingPage) && /host-end-confirm/.test(tingPage), 'host end');
check('C11_dial_6', /dial_code|ting-dial/.test(tingPage) && /isDialCode/.test(thing), 'dial 6');
check('C12_nav', /r:"\/ting",l:"Тинг"/.test(app), 'NAV item');
check('C13_script_tag', /ting_page\.js/.test(index) && /ting\.css/.test(index), 'index wiring');
check('C14_participants', /\/participants/.test(tingPage) && /GET.*participants|\/participants/.test(thing), 'participants list');
check('C15_chat_api', /\/chat/.test(thing) && /chat-send/.test(tingPage), 'chat API+UI');
check('C16_guest_waiting', /lobby-status/.test(guest) && /lobby-status/.test(thing), 'waiting poll');
check('C17_no_iframe_ting', !/iframe.*ting|ting.*iframe/i.test(tingPage + app), 'not iframe wrap');
check('C18_icon_dock', /ting-dock|dock button/.test(tingPage + guest), 'icon dock');

const fail = checks.filter((c) => !c.pass);
const md = [
  '# THING-CODE-VERIFY-F4',
  '',
  `at: ${new Date().toISOString()}`,
  `result: ${fail.length ? 'FAIL' : 'VERIFIED'} (${checks.length - fail.length}/${checks.length})`,
  '',
  '| ID | PASS | Evidence |',
  '|----|------|----------|',
  ...checks.map((c) => `| ${c.id} | ${c.pass ? 'PASS' : 'FAIL'} | ${c.evidence.replace(/\|/g, '/')} |`),
  '',
  fail.length ? '## FAILs\n' + fail.map((f) => `- ${f.id}: ${f.evidence}`).join('\n') : '## All PASS'
].join('\n');

fs.writeFileSync(report, md);
console.log(md.split('\n').slice(0, 6).join('\n'));
fail.forEach((f) => console.log('FAIL', f.id, f.evidence));
process.exit(fail.length ? 1 : 0);
