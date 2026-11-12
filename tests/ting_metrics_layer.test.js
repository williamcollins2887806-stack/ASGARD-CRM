'use strict';

/**
 * D-402: телеметрия должна брать ВЕРХНИЙ simulcast-слой, а не последний
 * попавшийся в отчёте getStats.
 *
 * Дефект: при simulcast publisher отдаёт несколько outbound-rtp (по слою).
 * Код перезаписывал поля на каждой итерации → в таблицу попадал последний
 * (нижний) слой: 320x180 / 121 кбит/с при нормальном канале. По этим цифрам
 * «доказывали» плохое качество, которого не было.
 */
const assert = require('assert');
const path = require('path');

/* Загружаем модуль как в браузере: он пишет в global. */
const MOD = path.join(__dirname, '..', 'public', 'assets', 'js', 'ting_media_profile.js');
require(MOD);
const profile = globalThis.TingMediaProfile;
assert.ok(profile && typeof profile.collectStats === 'function', 'TingMediaProfile.collectStats');

function report(entries) {
  /* Ключи как в настоящем RTCStatsReport: get(localCandidateId) должен находить
     local-candidate. Раньше мок генерировал id'ы вида 'id4', и проверка icePair
     «падала» на ошибке теста, а не на ошибке кода. */
  const map = new Map();
  entries.forEach((e, i) => {
    map.set(e.id || 'id' + i, e);
  });
  return {
    forEach: (fn) => map.forEach(fn),
    get: (id) => map.get(id),
  };
}

function transport(rep) {
  return { getStats: async () => rep };
}

(async () => {
  /* Три слоя simulcast: h180 (низкий), h360, h720 (верхний). */
  const pub = transport(report([
    { type: 'outbound-rtp', kind: 'video', frameWidth: 320, frameHeight: 180, framesPerSecond: 15, bytesSent: 1000, targetBitrate: 120000 },
    { type: 'outbound-rtp', kind: 'video', frameWidth: 640, frameHeight: 360, framesPerSecond: 25, bytesSent: 5000, targetBitrate: 600000 },
    { type: 'outbound-rtp', kind: 'video', frameWidth: 1280, frameHeight: 720, framesPerSecond: 30, bytesSent: 20000, targetBitrate: 1700000, qualityLimitationReason: 'none' },
    { type: 'candidate-pair', id: 'cp1', state: 'succeeded', selected: true, currentRoundTripTime: 0.031, localCandidateId: 'l1' },
    { type: 'local-candidate', id: 'l1', candidateType: 'srflx', protocol: 'udp' },
  ]));

  const s = await profile.collectStats(pub, null);
  assert.strictEqual(s.width, 1280, 'ширина должна быть у верхнего слоя, а не 320');
  assert.strictEqual(s.height, 720, 'высота 720, а не 180');
  assert.strictEqual(s.fps, 30, 'fps верхнего слоя');
  assert.strictEqual(s.limiter, 'none');
  assert.strictEqual(s.rttMs, 31);
  assert.strictEqual(s.icePair, 'srflx/udp');

  console.log('D-402 simulcast top layer: 6/6 OK');
})().catch((e) => {
  console.error('FAIL', e && e.message);
  process.exit(1);
});
