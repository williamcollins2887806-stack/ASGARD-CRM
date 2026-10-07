#!/usr/bin/env node
/**
 * Independent CODE verifier — Ting visual/UX plan.
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
const tingCss = fs.readFileSync(path.join(root, 'public/assets/css/ting.css'), 'utf8');
const guest = fs.readFileSync(path.join(root, 'public/ting/index.html'), 'utf8');
const thing = fs.readFileSync(path.join(root, 'src/routes/thing.js'), 'utf8');
const livekit = fs.readFileSync(path.join(root, 'src/services/thing-livekit.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/assets/js/app.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');

check('C01_no_skoro_toast', !/скоро появится|coming soon|заглушк|toast\(['\"]скоро/i.test(tingPage), 'no stub toasts');
check('C02_livekit_cdn', /livekit-client@2/.test(tingPage) && /room\.connect/.test(tingPage), 'LiveKit connect');
check('C03_guest_livekit', /room\.connect|LivekitClient/.test(guest), 'guest LiveKit');
check('C04_lobby_default_off', /lobby_enabled:\s*lobby/.test(tingPage) && /ting-lobby/.test(tingPage) && !/#ting-lobby" checked/.test(tingPage) && !/id="ting-lobby" checked/.test(tingPage), 'lobby checkbox unchecked by default');
check('C05_no_kick_word', !/\bКик\b|Mute all|toast\(['\"]Kick/i.test(tingPage) && !/>Kick</i.test(tingPage), 'no Kick/Mute all UI anglicisms');
check('C06_no_modul_crm', !/модуль CRM/.test(tingPage), 'no «модуль CRM»');
check('C07_incall_chrome', /ting-incall/.test(tingPage) && /ting-incall/.test(tingCss), 'CRM chrome hide class');
check('C08_chat_sidebar', /ting-chat/.test(tingPage) && /grid-area:\s*chat/.test(tingCss), 'chat always side column');
check('C09_screenshare', /setScreenShareEnabled/.test(tingPage) && /setScreenShareEnabled/.test(guest), 'screen share API');
check('C10_live_loop', /startLiveLoop|setInterval\(async/.test(tingPage), 'live refresh loop');
check('C11_hub_telemost', /Новый Тинг/.test(tingPage) && /Подключиться/.test(tingPage) && /Запланировать/.test(tingPage), 'hub Telemost IA');
check('C12_logo_mark', /ting-logo-mark/.test(tingPage) && /ting-logo-mark/.test(tingCss), 'logo mark');
check('C13_grid_speaker', /layout === 'speaker'|layout-toggle/.test(tingPage), 'grid/speaker modes');
check('C14_floating_dock', /ting-dock-inner/.test(tingPage) && /ting-dock-inner/.test(tingCss), 'floating dock');
check('C15_tile_mic_label', /ting-tile|\.lbl/.test(tingCss) && /svgMic/.test(tingPage), 'tile name+mic');
check('C16_public_chat', /public\/:code\/chat/.test(thing) && /public\/.*\/chat/.test(guest), 'guest public chat');
check('C17_remove_ru', /Удалить из комнаты/.test(tingPage), 'kick → Russian');
check('C18_mute_all_ru', /Выключить микрофоны у всех/.test(tingPage), 'mute-all Russian');
check('C19_qr_ready', /qrserver|ting-qr/.test(tingPage), 'QR on ready');
check('C20_share_link', /share-link|navigator\.share/.test(tingPage), 'share CTA');
check('C21_nav', /r:"\/ting",l:"Тинг"/.test(app), 'NAV item');
check('C22_script_tag', /ting_page\.js/.test(index) && /ting\.css/.test(index), 'index wiring');
check('C23_guest_css_shared', /assets\/css\/ting\.css/.test(guest), 'guest uses shared CSS');
check('C24_protocol_owner', /isProtocolOwner/.test(thing), 'protocol RBAC');
check('C25_recording', /recording\/start/.test(tingPage) && /recording\/stop/.test(tingPage), 'rec UI');
check('C26_host_end', /host-end-confirm/.test(tingPage), 'host end');
check('C27_dial', /ting-dial/.test(tingPage) && /isDialCode/.test(thing), 'dial-in');
check('C28_mobile', /@media \(max-width: 820px\)/.test(tingCss) && /\.ting-chat\.open/.test(tingCss) && /ting-people-drawer/.test(tingCss), 'mobile breakpoints + sheets');
check('C29_lobby_admit_api', /lobby\/:participantId\/admit/.test(thing), 'admit API still exists');
check('C30_no_iframe', !/iframe.*ting|ting.*iframe/i.test(tingPage + app), 'not iframe');
// ── C31..C36: видео-раскладка (анти-сплющивание) + имена ──
check('C31_no_legacy_fixed_height', !/\.ting-stage\.speaker[^{]*\{[^}]*min-height:\s*420px\s*!important/.test(tingCss),
  'легаси min-height:420px!important убран');
check('C32_aspect_ratio_16x9', /\.ting-stage\.speaker\s*>\s*\.ting-tile[^{]*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/.test(tingCss)
  && /\.ting-stage\.auto\s+\.ting-tile\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/.test(tingCss), 'aspect-ratio 16/9 на тайлах');
check('C33_pip_4x3', /\.ting-tile\.is-pip\s*\{[^}]*aspect-ratio:\s*4\s*\/\s*3/.test(tingCss) && /is-pip/.test(tingPage),
  'PiP-сам-вид 4:3');
check('C34_swap_click', /swapPrimary/.test(tingPage) && /state\.swapPrimary\s*=\s*!state\.swapPrimary/.test(tingPage),
  'swap по клику');
check('C35_contain_screenshare', /video\.is-contain/.test(tingCss) && /classList\.add\('is-contain'\)/.test(tingPage) && /hasScreen/.test(tingPage),
  'screen-share object-fit: contain + подпись track по source=screen');
check('C36_placeholder_name_fallback', /isPlaceholderDisplayName/.test(thing) && /r\.user_name\s*\|\|\s*r\.guest_name/.test(thing),
  'заглушка «Участник» → ФИО из users');
check('C37_landscape_low_height', /orientation:\s*landscape/.test(tingCss) && /max-height:\s*600px/.test(tingCss),
  'ландшафт телефона: ограничение по высоте');

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
console.log(md.split('\n').slice(0, 8).join('\n'));
fail.forEach((f) => console.log('FAIL', f.id, f.evidence));
process.exit(fail.length ? 1 : 0);
