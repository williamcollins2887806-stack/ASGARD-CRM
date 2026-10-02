'use strict';

const { startEmuApp, api, assert } = require('./harness');

module.exports.id = 'E04';
module.exports.title = 'Blind transfer via PBX API';

module.exports.run = async function run() {
  const app = await startEmuApp();
  try {
    const channel = 'PJSIP/emu-main';
    const target = 'u_peer2';

    const r = await api(app, 'POST', '/api/telephony/pbx/call/transfer', {
      channel,
      target,
      mode: 'blind',
    });
    assert(r.status === 200, 'blind transfer 200, got ' + r.status + ' ' + JSON.stringify(r.body));
    assert(r.body.mode === 'blind' || r.body.ok === true, 'blind mode ack');

    const acts = app.cmd.ami.actions;
    assert(
      acts.some((a) => a.Action === 'Redirect' && a.context === 'transfer' && a.exten === 'blind'),
      'AMI Redirect to transfer/blind: ' + JSON.stringify(acts)
    );
    // TRANSFER_TARGET is set via setVar (not always in actions log)
    assert(app.cmd.ami.channels.get(channel)?.TRANSFER_TARGET === target, 'TRANSFER_TARGET stored on channel');

    // empty target should still reach CMD (validation may be AMI-side)
    const r2 = await api(app, 'POST', '/api/telephony/pbx/call/transfer', {
      channel,
      target: '',
      mode: 'blind',
    });
    assert(r2.status === 200 || r2.status === 400, 'empty target handled, got ' + r2.status);

    return { actions: acts.length };
  } finally {
    await app.close();
  }
};
