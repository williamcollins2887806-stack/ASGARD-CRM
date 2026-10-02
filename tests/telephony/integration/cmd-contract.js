'use strict';

/**
 * Контракт AMI-вызовов CMD HTTP (без реального AMI) — зеркало src/pbx/index.js createCmdServer.
 */
const { MockAmi } = require('../scenarios/_mocks');

async function cmdTransferBlind(ami, body) {
  if (!body.channel) throw new Error('channel required');
  await ami.setVar(body.channel, 'TRANSFER_TARGET', body.target || '');
  await ami.redirect(body.channel, 'transfer', 'blind', 1);
}

async function cmdTransferConsult(ami, body) {
  if (!body.channel) throw new Error('channel required');
  await ami.redirect(body.channel, 'hold', 's', 1);
  if (body.target) {
    const ch = body.target.includes('/') ? body.target : `PJSIP/${body.target}`;
    await ami.originate({
      Channel: ch,
      Context: 'transfer',
      Exten: 'consult',
      Priority: 1,
      Async: 'true',
      Variable: `CONSULT_TARGET=${body.target}`,
    });
  }
}

async function cmdHold(ami, body) {
  if (!body.channel) throw new Error('channel required');
  if (body.hold === false) {
    await ami.redirect(body.channel, 'from-mango-inbound', 's', 1);
  } else {
    await ami.redirect(body.channel, 'hold', 's', 1);
  }
}

async function cmdHangup(ami, body) {
  if (!body.channel) throw new Error('channel required');
  await ami.hangup(body.channel);
}

async function cmdBridge(ami, body) {
  if (body.channel1 && body.channel2) {
    await ami.bridge(body.channel1, body.channel2);
  }
}

async function cmdOriginateOutbound(ami, body) {
  await ami.originate({
    Action: 'Originate',
    Channel: body.Channel || body.channel,
    Context: body.Context || body.context || 'outbound-crm',
    Exten: body.Exten || body.exten,
    Priority: body.Priority || 1,
    CallerID: body.CallerID || body.callerId,
    Async: body.Async || 'true',
    ...(body.Variable ? { Variable: body.Variable } : {}),
  });
}

function newMockAmi() {
  const ami = new MockAmi();
  return ami;
}

module.exports = {
  newMockAmi,
  cmdTransferBlind,
  cmdTransferConsult,
  cmdHold,
  cmdHangup,
  cmdBridge,
  cmdOriginateOutbound,
};
