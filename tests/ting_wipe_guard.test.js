/**
 * Guard: mid-call wipe anti-patterns must stay gone.
 * Run: node tests/ting_wipe_guard.test.js
 */
'use strict';
var fs = require('fs');
var page = fs.readFileSync('public/assets/js/ting_page.js', 'utf8');
var huginn = fs.readFileSync('public/assets/js/huginn_ting.js', 'utf8');
var sess = fs.readFileSync('public/assets/js/ting_session.js', 'utf8');
var css = fs.readFileSync('public/assets/css/ting.css', 'utf8');
var guest = fs.readFileSync('public/ting/index.html', 'utf8');
var tv = fs.readFileSync('public/ting-tv/index.html', 'utf8');
var fails = [];

function ok(name, cond) {
  if (!cond) fails.push(name);
  else console.log('PASS', name);
}

ok('syncCrmRoster exists', page.indexOf('function syncCrmRoster') >= 0);
ok('bumpRoster uses syncCrmRoster', /bumpRoster[\s\S]{0,200}syncCrmRoster/.test(page));
ok('AS no paintTiles', /Запрет paintTiles на speaker-event[\s\S]{0,120}relayoutTiles\(\)/.test(page));
ok('resize no render', /addEventListener\('resize'[\s\S]{0,200}relayoutTiles/.test(page) && !/addEventListener\('resize'[\s\S]{0,120}render\(\)/.test(page));
ok('reconnect fresh token', page.indexOf('Всегда свежий /token') >= 0);
ok('toggle-more soft', page.indexOf('insertAdjacentHTML(\'beforeend\', moreSheetHtml())') >= 0);
ok('hide-remote no paint', /hide-remote-toggle[\s\S]{0,250}без wipe/.test(page));
ok('pip above dock', css.indexOf('var(--ting-dock-h') >= 0 && css.indexOf('z-index: 8') >= 0);
ok('huginn soft speaker', huginn.indexOf('Soft swap: не innerHTML') >= 0 || huginn.indexOf('T-PIP-01') >= 0);
ok('huginn data-id', huginn.indexOf("setAttribute('data-id'") >= 0);
ok('guest settle 1400', guest.indexOf('activeSpeakerId ? 1400 : 600') >= 0);

/* Round-2 after join incremental (T-WIPE-01). */
ok('ensureCrmParticipantTile', page.indexOf('function ensureCrmParticipantTile') >= 0);
ok('join missing uses ensure not paint', /missing\.length\)[\s\S]{0,180}ensureCrmParticipantTile/.test(page)
  && !/missing\.length\)[\s\S]{0,120}paintTiles\(\)/.test(page));
ok('reattachVideosToTiles', page.indexOf('function reattachVideosToTiles') >= 0);
ok('reconnected soft path', /RoomEvent\.Reconnected[\s\S]{0,800}reattachVideosToTiles/.test(page));
ok('share soft reattach', /act === 'share'[\s\S]{0,900}reattachVideosToTiles/.test(page));
ok('remove uses syncCrmRoster', /act === 'remove'[\s\S]{0,350}syncCrmRoster/.test(page));
ok('layout soft re-parent', /Soft layout: re-parent/.test(page));
ok('screen mute not cam-off', /Screen mute ≠ cam-off/.test(page));
ok('tv screen mute skip', /Screen mute ≠ cam-off \(T-MUTE-02\)/.test(tv));
ok('tv reconnect fresh guest-token', /T-TV-01[\s\S]{0,400}guest-token/.test(tv));
ok('huginn soft without length<=2 gate', /havePrimary && haveInset\)/.test(huginn)
  && !/havePrimary && haveInset && existing\.length <= 2/.test(huginn));

/* Round-3 T-WIPE-02 soft mid-call chrome. */
ok('softRoomChrome exists', page.indexOf('function softRoomChrome') >= 0);
ok('hasLiveStage exists', page.indexOf('function hasLiveStage') >= 0);
ok('rec-start soft', /act === 'rec-start'[\s\S]{0,350}softRoomChrome/.test(page));
ok('rec-stop soft', /act === 'rec-stop'[\s\S]{0,350}softRoomChrome/.test(page));
ok('autoStartRecording soft', /Запись включена автоматически[\s\S]{0,200}softRoomChrome/.test(page));
ok('noise soft', /act === 'noise-toggle'[\s\S]{0,900}softRoomChrome/.test(page));
ok('poll-vote soft', /act === 'poll-vote'[\s\S]{0,450}softRoomChrome/.test(page));
ok('overflow soft relayout', /T-WIPE-02 overflow[\s\S]{0,120}relayoutTiles/.test(page));
ok('syncPeopleDrawer no mid-call render', /syncPeopleDrawer[\s\S]{0,280}T-WIPE-02[\s\S]{0,120}return;/.test(page));
ok('demoRoster to 15', /Math\.min\(15,/.test(page) && page.indexOf("['m', 'Кирилл']") >= 0);

/* T-SESS-01 */
ok('AsgardTing exports enableLocalCamera', /AsgardTing = \{[\s\S]{0,200}enableLocalCamera:\s*enableLocalCamera/.test(page));
ok('session connect uses AsgardTing.enableLocalCamera', /T-SESS-01[\s\S]{0,400}AsgardTing\.enableLocalCamera/.test(sess));
ok('session setCamEnabled uses AsgardTing', /async function setCamEnabled[\s\S]{0,500}AsgardTing\.enableLocalCamera/.test(sess));

if (fails.length) {
  console.error('FAIL', fails);
  process.exit(1);
}
console.log('OK ting_wipe_guard', 35);
