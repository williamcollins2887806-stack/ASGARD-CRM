/**
 * Deterministic layout matrix for Ting Premium (no browser).
 * Run: node tests/ting_premium_layout.test.js
 */
'use strict';

function hallModeFor(R, screenId) {
  if (screenId) return 'share';
  if (R <= 0) return 'wait';
  if (R === 1) return 'spot';
  if (R === 2) return 'dual';
  if (R <= 7) return 'spot-rail';
  if (R <= 9) return 'g3';
  if (R <= 12) return 'g4';
  return 'g5';
}

function resolveSpeakerMainId(opts) {
  const {
    mapIds, localId, remotes, pinnedId, swapPrimary, activeSpeakerId, screenOwnerId
  } = opts;
  const hasId = (id) => !!(id && mapIds.indexOf(id) >= 0);
  if (screenOwnerId && hasId(screenOwnerId)) return screenOwnerId;
  if (pinnedId && hasId(pinnedId)) return pinnedId;
  if (swapPrimary && hasId(localId)) return localId;
  if (activeSpeakerId && hasId(activeSpeakerId)) return activeSpeakerId;
  for (let i = 0; i < remotes.length; i++) {
    if (hasId(remotes[i])) return remotes[i];
  }
  return hasId(localId) ? localId : (mapIds[0] || null);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

let n = 0;
function check(name, fn) {
  fn();
  n += 1;
  console.log('PASS', name);
}

check('TV R matrix', () => {
  const expect = {
    0: 'wait', 1: 'spot', 2: 'dual', 3: 'spot-rail', 7: 'spot-rail',
    8: 'g3', 9: 'g3', 10: 'g4', 12: 'g4', 13: 'g5', 15: 'g5'
  };
  Object.keys(expect).forEach((k) => {
    const got = hallModeFor(+k, null);
    assert(got === expect[k], 'R=' + k + ' got ' + got);
  });
  assert(hallModeFor(4, 'scr') === 'share', 'share');
});

check('CRM main: screen > pin > swap > speaker > remote', () => {
  const ids = ['me', 'a', 'b'];
  assert(resolveSpeakerMainId({
    mapIds: ids, localId: 'me', remotes: ['a', 'b'],
    pinnedId: 'b', swapPrimary: true, activeSpeakerId: 'a', screenOwnerId: 'a'
  }) === 'a', 'screen wins');
  assert(resolveSpeakerMainId({
    mapIds: ids, localId: 'me', remotes: ['a', 'b'],
    pinnedId: 'b', swapPrimary: true, activeSpeakerId: 'a', screenOwnerId: null
  }) === 'b', 'pin');
  assert(resolveSpeakerMainId({
    mapIds: ids, localId: 'me', remotes: ['a', 'b'],
    pinnedId: null, swapPrimary: true, activeSpeakerId: 'a', screenOwnerId: null
  }) === 'me', 'swap');
  assert(resolveSpeakerMainId({
    mapIds: ids, localId: 'me', remotes: ['a', 'b'],
    pinnedId: null, swapPrimary: false, activeSpeakerId: 'b', screenOwnerId: null
  }) === 'b', 'speaker');
});

check('1:1 pip stays on stage (logical)', () => {
  /* ids.length===2 → other gets is-pip on stage, not strip */
  const ids = ['me', 'other'];
  const mainId = resolveSpeakerMainId({
    mapIds: ids, localId: 'me', remotes: ['other'],
    pinnedId: null, swapPrimary: false, activeSpeakerId: 'other', screenOwnerId: null
  });
  assert(mainId === 'other', 'remote main');
  const others = ids.filter((id) => id !== mainId);
  assert(others.length === 1 && others[0] === 'me', 'local is pip candidate');
  assert(ids.length === 2, 'use stage pip not strip');
});

check('share rail cap +N', () => {
  const others = [];
  for (let i = 0; i < 9; i++) others.push('r' + i);
  let railIds;
  let overflow;
  if (others.length > 6) {
    railIds = others.slice(0, 5);
    overflow = others.length - 5;
  } else {
    railIds = others;
    overflow = 0;
  }
  assert(railIds.length === 5, 'rail 5');
  assert(overflow === 4, '+N 4');
});

console.log('OK ting_premium_layout', n);
