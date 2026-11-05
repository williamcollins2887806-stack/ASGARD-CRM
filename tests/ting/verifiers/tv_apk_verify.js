#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../../..');
const checks = [];
function check(id, pass, evidence) {
  checks.push({ id, pass: !!pass, evidence: String(evidence || '') });
}

const tvHtml = fs.readFileSync(path.join(root, 'public/ting-tv/index.html'), 'utf8');
const tvCss = fs.readFileSync(path.join(root, 'public/assets/css/ting-tv.css'), 'utf8');
const indexJs = fs.readFileSync(path.join(root, 'src/index.js'), 'utf8');
const manifest = fs.readFileSync(path.join(root, 'ting-android/android/app/src/main/AndroidManifest.xml'), 'utf8');
const mainAct = fs.readFileSync(path.join(root, 'ting-android/android/app/src/main/java/com/asgard/ting/room/MainActivity.java'), 'utf8');
const cap = fs.readFileSync(path.join(root, 'ting-android/capacitor.config.ts'), 'utf8');

check('TV01_spa', /Зал совещаний/.test(tvHtml) && /guest-token/.test(tvHtml), 'TV SPA guest-token + default name');
check('TV02_cam_handoff', /enableLocalCamera/.test(tvHtml) && /releasePreviewKeepVideoTrack/.test(tvHtml) && /enumerateDevices/.test(tvHtml), 'cam handoff + enumerateDevices');
check('TV03_no_screenshare', !/setScreenShareEnabled/.test(tvHtml) && !/btnShare/.test(tvHtml), 'no screen share on TV');
check('TV04_dpad', /ArrowDown|keydown/.test(tvHtml) && /ttv-focus|--ttv-focus/.test(tvCss), 'D-pad + focus ring');
check('TV05_active_speaker', /ActiveSpeakersChanged/.test(tvHtml) && /is-speaking/.test(tvCss), 'active speaker ring');
check('TV06_route', /ting-tv/.test(indexJs) && /tingTvIndexPath/.test(indexJs), '/ting-tv route');
check('TV07_leanback', /LEANBACK_LAUNCHER/.test(manifest) && /CAMERA/.test(manifest) && /RECORD_AUDIO/.test(manifest), 'leanback + AV perms');
check('TV08_webrtc_grant', /onPermissionRequest/.test(mainAct) && /request\.grant/.test(mainAct), 'WebView PermissionRequest grant');
check('TV09_cap_id', /com\.asgard\.ting\.room/.test(cap) && /ting-tv/.test(cap), 'Capacitor appId + server url');
check('TV10_prefs', /Preferences|prefsSet|PREF_NAME/.test(tvHtml), 'room name prefs');
check('TV11_report', fs.existsSync(path.join(root, 'tests/reports/TING-TV-APK.md')), 'TING-TV-APK.md');
check('TV12_qr', /qrserver|qrImg/.test(tvHtml), 'QR for phones');

const fail = checks.filter((c) => !c.pass);
const md = [
  '# TING-TV-APK-VERIFY',
  '',
  `at: ${new Date().toISOString()}`,
  `result: ${fail.length ? 'FAIL' : 'VERIFIED'} (${checks.length - fail.length}/${checks.length})`,
  '',
  '| ID | PASS | Evidence |',
  '|----|------|----------|',
  ...checks.map((c) => `| ${c.id} | ${c.pass ? 'PASS' : 'FAIL'} | ${c.evidence.replace(/\|/g, '/')} |`),
  '',
  fail.length ? '## FAILs\n' + fail.map((f) => `- ${f.id}`).join('\n') : '## All PASS'
].join('\n');
fs.writeFileSync(path.join(root, 'tests/reports/TING-TV-APK-VERIFY.md'), md);
console.log(md.split('\n').slice(0, 8).join('\n'));
fail.forEach((f) => console.log('FAIL', f.id, f.evidence));
process.exit(fail.length ? 1 : 0);
