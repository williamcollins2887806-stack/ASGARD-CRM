'use strict';

const { startEmuApp, api, assert } = require('./harness');

module.exports.id = 'E05';
module.exports.title = 'Consult transfer via PBX API';

module.exports.run = async function run() {
  const app = await startEmuApp();
  try {
    const channel = 'PJSIP/emu-consult-main';
    const target = 'u_consult';

    const r = await api(app, 'POST', '/api/telephony/pbx/call/transfer', {
      channel,
      target,
      mode: 'consult',
    });
    assert(r.status === 200, 'consult transfer 200, got ' + r.status + ' ' + JSON.stringify(r.body));
    assert(r.body.mode === 'consult' || r.body.ok === true, 'consult mode ack');

    const acts = app.cmd.ami.actions;
    assert(
      acts.some((a) => a.Action === 'Redirect' && (a.context === 'hold' || a.Context === 'hold')),
      'consult: hold Redirect: ' + JSON.stringify(acts)
    );
    assert(
      acts.some((a) => a.Action === 'Originate' && (a.Exten === 'consult' || a.exten === 'consult')),
      'consult: Originate Exten=consult: ' + JSON.stringify(acts)
    );

    return { actions: acts.length };
  } finally {
    await app.close();
  }
};
