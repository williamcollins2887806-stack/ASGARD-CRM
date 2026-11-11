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
check('C47_bg_effects_removed',
  (() => {
    /* Виртуальные фоны и размытие отключены намеренно: MediaPipe-сегментация
       на каждом кадре роняла FPS и текла VideoFrame'ами («A VideoFrame was
       garbage collected without being closed»). Проверяем код и разметку,
       не считая комментарии, где описано удалённое. */
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
    const p = strip(tingPage);
    const g = strip(guest);
    return !/TING_BG_PRESETS/.test(p)
      && !/VirtualBackground/.test(p)
      && !/ting-bg-effects/.test(p)
      && !/setProcessor/.test(p)
      && !/guestBgGrid/.test(g)
      && !/livekit-track-processors/.test(g)
      && !/data-bg=/.test(g)
      && !/data-act="bg-preset"/.test(p);
  })(),
  'виртуальные фоны и размытие отключены (нет UI и загрузки процессоров)');
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
const tingTvCss = fs.readFileSync(path.join(root, 'public/assets/css/ting-tv.css'), 'utf8');
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
/* C65 (D-184): политика качества пересмотрена. 4K/8 Мбит/с вверх душили Wi-Fi ТВ
   и были корнем «140p у собеседника». Теперь: потолок h720, три слоя, H264 только
   при поддержке, backupCodec выключен, degradationPreference в publish-опциях. */
/* C65 (D-192): профиль публикации переехал в общий модуль ting_media_profile.js.
   Раньше проверка смотрела в ТВ, где была локальная копия; три копии разошлись
   (CRM и гость держали пять слоёв с верхним 4K — отсюда «360p»). Теперь проверяем
   модуль и то, что все три поверхности его используют. */
const mediaProfile = fs.readFileSync(path.join(root, 'public/assets/js/ting_media_profile.js'), 'utf8');
check('C65_video_720_cap_h264',
  /function h264Supported/.test(mediaProfile)
  && /RTCRtpSender\.getCapabilities/.test(mediaProfile)
  && /videoCodec:\s*h264Supported\(\)\s*\?\s*'h264'\s*:\s*'vp8'/.test(mediaProfile)
  && /backupCodec:\s*false/.test(mediaProfile)
  && /degradationPreference:\s*'maintain-resolution'/.test(mediaProfile)
  && !/h2160/.test(mediaProfile)
  && /TingMediaProfile/.test(tingTv)
  && /TingMediaProfile/.test(tingPage)
  && /TingMediaProfile/.test(guest),
  'общий профиль: потолок 720p, H264 с проверкой, без двух кодеков, во всех поверхностях');
/* C66: корень «144/360p». Лобби открывало камеру как `video: true` (640×480),
   и этот же трек публиковался в звонок — энкодер h1080 растягивал 480p.
   Теперь preview обязан быть HD, а суб-HD трек не переиспользуется. */
const hdRe = /(?:width:\s*\{\s*ideal:\s*(?:1280|1920|2560|3840)\s*\}|ideal:\s*(?:1280|1920|2560|3840))/;
check('C66_preview_hd_gate',
  /function previewTrackIsHd/.test(tingPage)
  && /previewTrackIsHd\(vt\)/.test(tingPage)
  && hdRe.test(tingPage)
  && /function trackIsHd/.test(guest)
  && /trackIsHd\(videoTrack\)/.test(guest)
  && /width: hdVideo\.width/.test(tingTv)
  && /ideal: CAPTURE_RES\.width/.test(tingTv),
  'preview с явным разрешением + суб-HD трек не публикуется (CRM/гость/ТВ)');
/* C67: качество адаптируется под канал: HIGH→MEDIUM→LOW по связи,
   а не жёсткий HIGH навсегда (на слабом канале это фризы). */
const core = fs.readFileSync(path.join(root, 'public/assets/js/ting_room_core.js'), 'utf8');
/* C67: лестница качества. В CRM она осталась (adaptive выключен). На ТВ
   ручная лестница УБРАНА намеренно: при adaptiveStream SDK блокирует
   setVideoQuality, и вызовы молча игнорировались. Плохой канал на ТВ
   обрабатывает lowSpeed — скрывает видео и показывает баннер. */
check('C67_quality_auto_ladder',
  /videoQualityLadder/.test(tingPage)
  && /qualityEnum/.test(tingPage)
  && /tuneQualityForConnection/.test(tingPage)
  && /VideoQuality\.MEDIUM/.test(tingPage)
  && /ConnectionQualityChanged/.test(tingPage)
  /* На ТВ — adaptive, а не ручная лестница. */
  && /adaptiveStream:\s*true/.test(tingTv)
  && !/setVideoQuality/.test(tingTv.replace(/\/\*[\s\S]*?\*\//g, '')),
  'CRM: ручная лестница; ТВ: adaptiveStream без ручных setVideoQuality');
/* C68: низкая скорость — скрытие видео АДРЕСНО (только у участника с плохим
   каналом), баннер, автовосстановление. Раньше пряталось у всех — это баг. */
check('C68_low_speed_banner',
  /noteConnectionQuality/.test(core)
  && /hiddenIds/.test(core)
  && /LOW_SPEED_DOWN_MS/.test(core)
  && /LOW_SPEED_UP_MS/.test(core)
  && /ting-net-banner/.test(core)
  && /is-video-hidden/.test(core)
  && /ting-net-banner/.test(tingCss)
  && /is-video-hidden/.test(tingCss)
  && /lowSpeed/.test(guest)
  && /lowSpeed/.test(tingTv),
  'адресное скрытие видео + баннер + автовозврат (3 поверхности)');
/* C69: скрытие адресное — общий «выключить всем» недопустим. */
check('C69_low_speed_is_per_participant',
  /noteConnectionQuality\(q, id\)/.test(core)
  && /hiddenIds\[id\]/.test(core)
  && /TingRoomCore\.lowSpeed\.note\(qNorm, who\)/.test(tingPage)
  && /isSelf \? null : \(participant && participant\.identity\)/.test(guest)
  && /isSelf \? null : \(participant && participant\.identity\)/.test(tingTv),
  'качество приходит per-participant, id передаётся во всех трёх поверхностях');

/* C70: в обработчике LocalTrackPublished не должно быть переменной
   participant — её там нет, это давало Uncaught ReferenceError и рвало
   обновление плиток и меню. */
check('C70_local_track_published_no_participant',
  (() => {
    const i = tingPage.indexOf('RoomEvent.LocalTrackPublished, (pub)');
    if (i < 0) return false;
    const block = tingPage.slice(i, i + 1600);
    return !/bumpPublicationQuality\(pub,\s*participant\)/.test(block)
      && /bumpPublicationQuality\(pub,\s*lp\)/.test(block);
  })(),
  'LocalTrackPublished: bumpPublicationQuality(pub, lp), без ReferenceError');
/* C71: видео на ТВ обязано стартовать явным play() — autoplay в Android
   WebView не гарантирует воспроизведение (серый значок «плей»). */
check('C71_tv_video_explicit_play',
  /track\.attach\(video\)/.test(tingTv)
  && /video\.play\(\)\.catch/.test(tingTv),
  'TV: play() после attach — нет серого «плей»');
/* C72: AEC/NS/AGC у гостя. Без них близко стоящие устройства слышат друг
   друга — писк и эхо. */
check('C72_guest_audio_constraints',
  !/setMicrophoneEnabled\(localAudio\)/.test(guest)
  && !/setMicrophoneEnabled\(localAudio\)/.test(tingPage)
  && (guest.match(/noiseSuppression:\s*true/g) || []).length >= 2
  && /audioCaptureDefaults/.test(guest)
  && /echoCancellation:\s*true/.test(guest),
  'гость: setMicrophoneEnabled(..., {AEC/NS/AGC}) + audioCaptureDefaults');
/* C73: adaptiveStream и ручной setVideoQuality несовместимы — SDK блокирует
   смену качества и пишет «adaptive stream is enabled». На десктопе adaptive
   выключен, на мобильном — включён и ручной вызов не делается. */
check('C73_adaptive_vs_manual_quality',
  /adaptiveStream:\s*smallEarly/.test(guest)
  && /!smallEarly\s*&&\s*pub/.test(guest),
  'гость: adaptive только на мобильном, HIGH вручную только на десктопе');
/* C74: ТВ-микрофон судим по факту публикации, а не по isMicrophoneEnabled:
   у трека, созданного напрямую, source может быть unknown, и геттер врёт. */
check('C74_tv_mic_by_publication',
  (() => {
    const i = tingTv.indexOf('function micIsPublishing');
    if (i < 0) return false;
    const block = tingTv.slice(i, i + 900);
    /* Порядок критичен: isMuted ДО liveness. Иначе ветка «живой трек» всегда
       истинна (readyState остаётся 'live' после mute) и мьют невидим. */
    const mute = block.indexOf('isMuted === true');
    const live = block.indexOf('info.live');
    return !/isMicrophoneEnabled === false/.test(block)
      && mute > 0 && live > 0 && mute < live;
  })()
  && /audioCaptureDefaults/.test(tingTv)
  && !/new LK\.LocalAudioTrack\(mst, undefined, false\)/.test(tingTv),
  'TV: micIsPublishing (mute до liveness) + audioCaptureDefaults + чистый конструктор');
/* C75: плитки галереи. Стратегия зависит от пропорции ячейки:
   g3 — ячейка шире кадра, ограничивает высота; g4/g5 — уже, ограничивает
   ширина. Один общий рецепт ломает одну из групп (было 1.568 в g4 и 1.247
   в g5 при норме 1.778). */
check('C75_tv_gallery_no_stretch',
  (() => {
    /* Комментарии не считаем: в них встречается описание старого дефекта. */
    const css = tingTvCss.replace(/\/\*[\s\S]*?\*\//g, '');
    const g45 = /\.ttv-stage\.hall-g4[^{]*\{[^}]*aspect-ratio:\s*16\s*\/\s*9[^}]*width:\s*100%[^}]*height:\s*auto/.test(css);
    const g3 = /\.ttv-stage\.hall-g3[^{]*\{[^}]*aspect-ratio:\s*16\s*\/\s*9[^}]*height:\s*100%[^}]*width:\s*auto/.test(css);
    return g45 && g3
      && !/\.ttv-stage\.hall-g4[^{]*\{[^}]*max-width:\s*100%/.test(css)
      && /\.ttv-tile video\s*\{[^}]*object-fit:\s*contain/.test(css);
  })(),
  'TV: g3 по высоте, g4/g5 по ширине, видео contain (лицо не обрезано)');

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
