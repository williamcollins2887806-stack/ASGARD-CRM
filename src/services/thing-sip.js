'use strict';

/**
 * Ensure LiveKit SIP inbound trunk + callee dispatch (dialed user = room name).
 */

async function ensureSipDialIn() {
  if (!process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
    return { ok: false, reason: 'LIVEKIT not configured' };
  }
  const { SipClient } = require('livekit-server-sdk');
  const sip = new SipClient(
    process.env.LIVEKIT_URL,
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET
  );

  let trunkId = null;
  const trunks = await sip.listSipInboundTrunk();
  const existingTrunk = (trunks || []).find((t) => t.name === 'asgard-asterisk-local');
  if (existingTrunk) {
    trunkId = existingTrunk.sipTrunkId;
  } else {
    const created = await sip.createSipInboundTrunk('asgard-asterisk-local', ['*'], {
      allowedAddresses: ['127.0.0.1', '::1']
    });
    trunkId = created.sipTrunkId;
  }

  const rules = await sip.listSipDispatchRule();
  const existingRule = (rules || []).find((r) => r.name === 'ting-callee-room');
  if (!existingRule) {
    await sip.createSipDispatchRule(
      { type: 'callee', roomPrefix: '', randomize: false },
      {
        name: 'ting-callee-room',
        trunkIds: trunkId ? [trunkId] : []
      }
    );
  }

  return { ok: true, trunkId };
}

module.exports = { ensureSipDialIn };
