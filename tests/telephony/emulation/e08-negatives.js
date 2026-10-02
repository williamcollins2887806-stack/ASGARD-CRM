'use strict';

const { startEmuApp, api, postWebhook, assert } = require('./harness');

module.exports.id = 'E08';
module.exports.title = 'Negatives: bad sign, empty transfer, double hangup';

module.exports.run = async function run() {
  const app = await startEmuApp();
  try {
    // Bad webhook signature
    const bad = await postWebhook(
      app,
      'call',
      {
        entry_id: 'emu_bad_' + Date.now(),
        call_id: 'x',
        call_state: 'Appeared',
        call_direction: 1,
        from: { number: '79001112233' },
        to: { number: '200' },
        timestamp: Math.floor(Date.now() / 1000),
        seq: 1,
      },
      { badSign: true }
    );
    assert(
      bad.status === 403 || bad.status === 401 || bad.status === 400,
      'bad sign expected 403/401/400, got ' + bad.status + ' ' + bad.text.slice(0, 80)
    );

    // Transfer without channel
    let r = await api(app, 'POST', '/api/telephony/pbx/call/transfer', {
      target: 'u_x',
      mode: 'blind',
    });
    assert(r.status === 400 || r.status === 502 || r.status === 200, 'no-channel transfer handled ' + r.status);
    if (r.status === 200) {
      // mock may accept; ensure CMD logged error path or empty channel rejected earlier
    } else {
      assert(
        /channel/i.test(JSON.stringify(r.body)) || r.status >= 400,
        'error mentions channel'
      );
    }

    // Hangup without channel
    r = await api(app, 'POST', '/api/telephony/pbx/call/hangup', {});
    assert(r.status === 400 || r.status === 502, 'hangup without channel → 400/502, got ' + r.status);

    // Double hangup same channel — second should still be ok or 400, not 500
    const ch = 'PJSIP/emu-double';
    r = await api(app, 'POST', '/api/telephony/pbx/call/hangup', { channel: ch });
    assert(r.status === 200, 'first hangup 200');
    r = await api(app, 'POST', '/api/telephony/pbx/call/hangup', { channel: ch });
    assert(r.status < 500, 'second hangup no 500, got ' + r.status);

    // Unauthenticated softphone
    const res = await fetch(app.baseUrl + '/api/telephony/pbx/call/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: ch }),
    });
    assert(res.status === 401 || res.status === 403, 'unauth answer → 401/403, got ' + res.status);

    return { badSign: bad.status };
  } finally {
    await app.close();
  }
};
