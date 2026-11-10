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
/* D24: LiveKit теперь self-hosted (/assets/vendor), внешний CDN запрещён.
   Принимаем либо локальный путь, либо явную зафиксированную версию. */
check('C02_livekit_cdn',
  /(\/assets\/vendor\/livekit-client\.umd\.min\.js|livekit-client@2\.\d+\.\d+)/.test(tingPage)
  && /room\.connect/.test(tingPage)
  && !/cdn\.jsdelivr\.net\/npm\/livekit/.test(tingPage),
  'LiveKit connect (self-hosted, без CDN)');
check('C03_guest_livekit', /room\.connect|LivekitClient/.test(guest), 'guest LiveKit');
check('C04_lobby_default_off', /lobby_enabled:\s*lobby/.test(tingPage) && /ting-lobby/.test(tingPage) && !/#ting-lobby" checked/.test(tingPage) && !/id="ting-lobby" checked/.test(tingPage), 'lobby checkbox unchecked by default');
check('C05_no_kick_word', !/\bКик\b|Mute all|toast\(['\"]Kick/i.test(tingPage) && !/>Kick</i.test(tingPage), 'no Kick/Mute all UI anglicisms');
check('C06_no_modul_crm', !/модуль CRM/.test(tingPage), 'no «модуль CRM»');
check('C07_incall_chrome', /ting-incall/.test(tingPage) && /ting-incall/.test(tingCss), 'CRM chrome hide class');
check('C08_chat_sidebar', /ting-chat/.test(tingPage) && /\.ting-chat\.open/.test(tingCss)
  && /position:\s*absolute/.test(tingCss), 'chat overlay drawer');
check('C09_screenshare', /setScreenShareEnabled/.test(tingPage) && /setScreenShareEnabled/.test(guest), 'screen share API');
check('C10_live_loop', /startLiveLoop|setInterval\(async/.test(tingPage), 'live refresh loop');
check('C11_hub_telemost', /Новый Тинг/.test(tingPage) && /Подключиться/.test(tingPage) && /Запланировать/.test(tingPage), 'hub Telemost IA');
check('C12_logo_mark', /ting-logo-(mark|glyph|tile)/.test(tingPage) && /ting-logo-(mark|glyph|tile)/.test(tingCss), 'logo mark');
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
  && (/\.ting-stage\.g4\s*>\s*\.ting-tile/.test(tingCss) || /\.ting-stage\.g10\s*>\s*\.ting-tile/.test(tingCss))
  && /aspect-ratio:\s*16\s*\/\s*9/.test(tingCss), 'aspect-ratio 16/9 на тайлах + g4/g10');
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
check('C38_start_live', /status\s*=\s*'live'/.test(thing) && !/status\s*=\s*'active'/.test(thing),
  '/start пишет live, не active');
check('C39_pickvideo_skip_muted', /isMuted/.test(tingPage) && /trackLive|pickVideo|trackIsLive/.test(tingPage)
  && /readyState\s*===\s*'live'|mediaStreamTrack/.test(fs.readFileSync(path.join(root, 'public/assets/js/ting_room_core.js'), 'utf8')),
  'pickVideo: live MediaStreamTrack wins over brief isMuted');
check('C40_people_chat_parallel', /peopleOpen \? '' : chatHtml/.test(tingPage) === false
  && /\$\{chatHtml\(\)\}/.test(tingPage),
  'people не убивает chatHtml');
check('C41_more_sheet', /toggle-more|ting-more-sheet/.test(tingPage) && /hand-toggle|react/.test(tingPage),
  'Ещё = settings + рука + реакции');
check('C42_room_core', fs.existsSync(path.join(root, 'public/assets/js/ting_room_core.js')),
  'ting_room_core.js shared module');
check('C43_reconnect_ux', /reconnecting|Переподключение/.test(tingPage) && /Переподключение|tryReconnect/.test(guest),
  'reconnect UX CRM+guest');
check('C44_calendar_create_thing', /create_thing/.test(fs.readFileSync(path.join(root, 'public/assets/js/calendar.js'), 'utf8')),
  'календарь шлёт create_thing');
check('C45_turn_ops', /coturn/.test(fs.readFileSync(path.join(root, 'ops/livekit/docker-compose.yml'), 'utf8'))
  && /turn_servers/.test(fs.readFileSync(path.join(root, 'ops/livekit/livekit.yaml'), 'utf8')),
  'coturn + turn_servers в ops');
check('C46_device_picker', /device-audio/.test(tingPage) && /device-video/.test(tingPage) && /switchTingDevice/.test(tingPage)
  && /guestMicSelect/.test(guest) && /switchGuestDevice/.test(guest),
  'device picker в Ещё CRM+guest');
check('C47_bg_presets', /TING_BG_PRESETS/.test(tingPage) && /office-dusk/.test(tingPage) && /VirtualBackground/.test(tingPage)
  && /guestBgGrid/.test(guest) && /warm-studio/.test(guest)
  && fs.existsSync(path.join(root, 'public/assets/img/ting-bg/office-dusk.svg'))
  && fs.existsSync(path.join(root, 'public/assets/img/ting-bg/soft-sky.svg'))
  && fs.existsSync(path.join(root, 'public/assets/img/ting-bg/warm-studio.svg')),
  '3 вирт.фона + blur wiring CRM+guest');
check('C48_2peer_smoke_artifact', (() => {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, 'tests/reports/TING-2PEER-MEDIA-SMOKE.json'), 'utf8'));
    return !!(j.pass && j.numerator === j.denominator);
  } catch (_) { return false; }
})(), 'TING-2PEER-MEDIA-SMOKE.json green');
check('C49_lobby_crm_name', /resolveLocalProfile/.test(tingPage) && /asgard_user/.test(tingPage)
  && /renderLobby/.test(tingPage),
  'lobby берёт ФИО из CRM-профиля');
check('C50_cinema_chat_overlay', /no-chat cinema|cinema/.test(tingPage)
  && /toggle-chat/.test(tingPage)
  && /transform:\s*translateX\((105%|calc\(100%\s*\+\s*\d+px\))\)/.test(tingCss)
  && /\.ting-chat\.open/.test(tingCss)
  && /visibility:\s*hidden/.test(tingCss),
  'desktop chat = overlay, не G-колонка');
check('C51_intentional_leave', /intentionalLeave/.test(tingPage) && /intentionalLeave/.test(guest),
  'leave/end без авто-reconnect reopen');
check('C52_icon_btn_svg_size', /\.ting-icon-btn svg\s*\{[^}]*width:\s*22px/.test(tingCss)
  && /flex-shrink:\s*0/.test(tingCss),
  'top icons fixed size, no overlap');
check('C53_guest_title_and_cam_race',
  /function roomTitleDisplay/.test(guest)
  && /\^вкс\$/.test(guest)
  && /NotReadable|Timeout starting video/.test(guest)
  && /enableLocalCamera|releasePreviewKeepVideoTrack/.test(guest)
  && guest.indexOf('enableLocalCamera') > -1,
  'guest: ВКС→Тинг + cam handoff (preview→publish)');
check('C54_no_video_controls',
  /v\.controls\s*=\s*false/.test(tingPage)
  && /hardenVideoEl|controls\s*=\s*false/.test(guest)
  && /::-webkit-media-controls/.test(tingCss),
  'native video controls off (CRM+guest+CSS)');
check('C55_grid_classes_g4_g10',
  /function stageGridClass/.test(tingPage)
  && /\.ting-stage\.g4\s*\{/.test(tingCss)
  && /\.ting-stage\.g10\s*\{/.test(tingCss)
  && /stageGridClass\(count\)/.test(tingPage),
  'premium g1..g10 matrices wired');
check('C56_friendly_http_toast',
  /friendlyHttpStatus|friendlyErrorMessage/.test(tingPage)
  && !/new Error\([^)]*'HTTP '\s*\+/.test(tingPage)
  && /Не найдено/.test(tingPage),
  'no raw HTTP status in user toasts');
check('C57_guest_relayout_grids',
  /function relayoutGuestTiles/.test(guest)
  && /stageGridClass\(ids\.length/.test(guest)
  && !/classList\.toggle\('g2',\s*layoutMode === 'grid'\)/.test(guest)
  && /filmstrip/.test(guest),
  'guest: g1..g10 + speaker filmstrip relayout');
check('C58_guest_attach_searches_strip',
  /strip\.querySelector\('\[data-id=/.test(guest)
  && /stage && stage\.querySelector\('\[data-id=/.test(guest),
  'attachTrack finds tiles in stage AND filmstrip');
check('C59_cam_preview_handoff',
  /function enableLocalCamera/.test(tingPage)
  && /Timeout starting video/.test(tingPage)
  && /setCameraEnabled\(true\)/.test(tingPage)
  && /enableLocalCamera:\s*enableLocalCamera/.test(tingPage),
  'CRM: enableLocalCamera + timeout cam publish');
check('C60_park_pip_on_nav',
  /function parkCallToPip/.test(tingPage)
  && /HuginnTing\.ensurePip/.test(tingPage)
  && /parkCallToPip\(\)/.test(tingPage)
  && /hashchange/.test(tingPage),
  'уход из #/ting → PiP, не leave');
check('C61_join_end_timeouts',
  /withTimeout/.test(tingPage)
  && /joinInFlight/.test(tingPage)
  && /Сервер не ответил на завершение|disconnect-timeout/.test(tingPage)
  && /Таймаут подключения к видеосерверу/.test(tingPage),
  'join UI early + end/disconnect timeouts');
check('C62_incall_credit_hidden',
  /html\.ting-incall\s+\.credit|body\.ting-incall\s+\.credit/.test(tingCss)
  && /overflow:\s*hidden\s*!important/.test(tingCss)
  && /ting-room-shell[\s\S]*position:\s*fixed/.test(tingCss),
  'ting-incall hides .credit + fixed room shell');

/* V4-hotfix (10.11.2026): три регресса, которые увидел директор на ТВ.
   C63 — «всё как раньше»: /assets/* immutable на 30 дней, значит страница
   обязана версионировать каждый подключаемый CSS/JS, иначе WebView держит
   старые стили при уже новом HTML.
   C64 — микрофон на ТВ публиковался без проверки и без фолбэка на протухший
   deviceId («микрофон не найден», хотя камера жила).
   C65 — качество: 1080p-пресет и HIGH-слой у зрителя, иначе «ужасная картинка». */
const tingTv = fs.readFileSync(path.join(root, 'public/ting-tv/index.html'), 'utf8');
const unversioned = (src) => (src.match(/(?:src|href)="\/assets\/[^"?]+"/g) || []);
check('C63_ting_pages_assets_versioned',
  unversioned(guest).length === 0
  && unversioned(tingTv).length === 0
  && /\?v=\d+\.\d+\.\d+/.test(guest)
  && /\?v=\d+\.\d+\.\d+/.test(tingTv)
  && /TING_PAGES/.test(fs.readFileSync(path.join(root, 'tools/bump_shell_version.js'), 'utf8')),
  'ting/ + ting-tv/: каждый /assets/* с ?v=, bump версионирует обе страницы');
check('C64_tv_mic_publish_verified',
  /function micIsPublishing/.test(tingTv)
  && /publishMicOnce\(room, false\)/.test(tingTv)
  && /createLocalAudioTrack/.test(tingTv)
  && /prefsSet\(PREF_MIC, ''\)/.test(tingTv),
  'TV mic: проверка публикации + фолбэк без deviceId');
check('C65_video_1080p_high',
  /VideoPresets\.h1080/.test(tingTv)
  && /VideoQuality\.HIGH/.test(tingTv)
  && /VideoPresets\.h1080/.test(tingPage)
  && /VideoPresets\.h1080/.test(guest),
  'h1080 пресет + HIGH-подписка на ТВ/CRM/госте');

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
