'use strict';

const { startEmuApp, api, assert } = require('./harness');

module.exports.id = 'E03';
module.exports.title = 'Softphone answer/hold/hangup/outbound via Mock CMD';

module.exports.run = async function run() {
  const app = await startEmuApp();
  try {
    const channel = 'PJSIP/emu-agent-0001';

    let r = await api(app, 'POST', '/api/telephony/pbx/call/answer', {
      channel,
      call_id: 'pbx_emu1',
    });
    assert(r.status === 200, 'answer expected 200, got ' + r.status + ' ' + JSON.stringify(r.body));
    assert(r.body.ok === true, 'answer body.ok');

    r = await api(app, 'POST', '/api/telephony/pbx/call/hold', { channel, hold: true });
    assert(r.status === 200, 'hold on expected 200, got ' + r.status + ' ' + JSON.stringify(r.body));

    r = await api(app, 'POST', '/api/telephony/pbx/call/hold', { channel, hold: false });
    assert(r.status === 200, 'hold off expected 200, got ' + r.status);

    r = await api(app, 'POST', '/api/telephony/pbx/call/outbound', { number: '74951234567' });
    assert(r.status === 200, 'outbound expected 200, got ' + r.status + ' ' + JSON.stringify(r.body));
    assert(
      app.cmd.ami.actions.some((a) => a.Action === 'Originate' || a.action === 'Originate' || a.Channel),
      'AMI Originate recorded'
    );

    r = await api(app, 'POST', '/api/telephony/pbx/call/hangup', { channel });
    assert(r.status === 200, 'hangup expected 200, got ' + r.status);

    const paths = app.cmd.log.map((x) => x.path);
    assert(paths.includes('/call/answer'), 'CMD got /call/answer');
    assert(paths.includes('/call/hold'), 'CMD got /call/hold');
    assert(paths.includes('/call/hangup'), 'CMD got /call/hangup');
    assert(paths.includes('/call/originate'), 'CMD got /call/originate');

    return { cmdCalls: app.cmd.log.length };
  } finally {
    await app.close();
  }
};
